import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import { signDpopProof } from "@/lib/dpop";
import { env } from "@/lib/env";
import { settlePayment, ZpayError } from "@/lib/zpay-client";
import {
  type SignPaymentInput,
  signedPayloadBytesToHex,
  signPayment,
  ZspendError,
} from "@/lib/zspend-client";

/**
 * POST /api/aether/sign
 *
 * Phase 5 BFF orchestrator (Proposal-0003 §8 Phase 5). The Aether agent
 * calls this after CIBA approval to drive the wallet runtime
 * (zspend-runtime) and forward the signed transaction to zpay's
 * `/x402/v2/settle`.
 *
 * Wire shape on this route is small and demo-shaped: callers post
 * `{ payment_uri, payment_id, network }` and receive back
 * `{ payment_id, transaction_id }`. The full
 * `payment_authorization` RAR flow (Phase 3) lands as a follow-on slice;
 * for the Phase 5 MVP the orchestrator skips the access-token presentation
 * to the wallet (zspend-runtime's Phase 4 MVP likewise skips token
 * verification) and trusts the demo-rp session for the bounded spend
 * intent.
 *
 * Errors discriminated by machine `error` tag:
 * - `session_required` (401) caller is not signed in
 * - `wallet_unreachable` (502) zspend-runtime did not respond
 * - `target_expiry_stale` (409) zspend rejected the caller's expiry as
 *   already past the chain tip; the caller must request a fresh
 *   /prepare and retry
 * - `settle_failed` (502) zpay /settle returned non-2xx
 * - `invalid_request` (400) zod parse failed
 */

const requestSchema = z.object({
  payment_uri: z.string().min(1),
  payment_id: z.string().min(1),
  network: z.enum(["mainnet", "testnet", "regtest"]),
  /**
   * The expiry height the caller committed to at /prepare time. zspend
   * routes this into the wallet's PCZT Updater so the signed bytes carry
   * the same value zpay will assert at /settle.
   */
  target_expiry_height: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  // Dev-only gate per Proposal-0003 §10. The Phase 5 MVP skips CIBA
  // authorization-details correlation, canonical-URI lookup, and
  // payment_id ownership checks; the route signs whatever URI the
  // caller supplies as long as they have a session. That posture is
  // acceptable for a local demo flow and is not safe for production.
  // The route refuses to serve when NODE_ENV is "production" so a
  // misconfigured deploy fails closed instead of silently shipping a
  // wallet-spend MVP.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "demo_only",
        error_description:
          "/api/aether/sign is gated to non-production builds until the CIBA correlation and ownership checks land (Proposal-0003 §10).",
      },
      { status: 503 }
    );
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.error.message },
      { status: 400 }
    );
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: "session_required",
        error_description:
          "Sign in before signing a payment; the wallet route refuses to drive a spend without an authenticated session.",
      },
      { status: 401 }
    );
  }

  const input: SignPaymentInput = {
    paymentRequest: { scheme: "zip321", value: parsed.data.payment_uri },
    network: parsed.data.network,
    paymentId: parsed.data.payment_id,
    targetExpiryHeight: parsed.data.target_expiry_height,
  };

  let signedResult: Awaited<ReturnType<typeof signPayment>>;
  try {
    signedResult = await signPayment(input);
  } catch (err) {
    if (err instanceof ZspendError && err.kind === "target_expiry_stale") {
      return NextResponse.json(
        {
          error: "target_expiry_stale",
          error_description:
            err.problem?.detail ?? err.problem?.title ?? err.message,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "wallet_unreachable",
        error_description:
          err instanceof Error ? err.message : "zspend sign failed",
      },
      { status: 502 }
    );
  }

  const rawTxHex = signedPayloadBytesToHex(signedResult.signedPayload);

  // Mint a DPoP proof for the zpay /settle call. The proof matches the
  // jkt used by /api/aether/prepare so the (jkt, idempotency_key)
  // composite zpay enforces resolves to this BFF process.
  const settleUrl = `${env.ZPAY_URL}/x402/v2/settle`;
  const { proofJwt } = await signDpopProof({
    method: "POST",
    url: settleUrl,
    jti: randomUUID(),
  });

  try {
    const settlement = await settlePayment({
      dpopProof: proofJwt,
      paymentId: parsed.data.payment_id,
      rawTxHex,
    });

    return NextResponse.json({
      payment_id: settlement.payment_id,
      transaction_id: settlement.broadcast_outcome.transaction_id ?? null,
      broadcast_kind: settlement.broadcast_outcome.kind,
      signed_payload: {
        format: signedResult.signedPayload.format,
        tx_id: signedResult.signedPayload.tx_id,
        fee: signedResult.signedPayload.fee,
        expires_at: signedResult.signedPayload.expires_at,
      },
    });
  } catch (err) {
    const description = describeSettleFailure(err);
    return NextResponse.json(
      {
        error: "settle_failed",
        error_description: description,
      },
      { status: 502 }
    );
  }
}

function describeSettleFailure(err: unknown): string {
  if (err instanceof ZpayError && err.problem) {
    return err.problem.detail ?? err.problem.title;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "settle failed";
}
