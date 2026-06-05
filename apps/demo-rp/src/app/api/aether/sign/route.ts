import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { signDpopProof } from "@/lib/dpop";
import { env } from "@/lib/env";
import { settlePayment } from "@/lib/zpay-client";
import {
  type SignPaymentInput,
  signedPayloadBytesToHex,
  signPayment,
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
 * - `settle_failed` (502) zpay /settle returned non-2xx
 * - `invalid_request` (400) zod parse failed
 */

const requestSchema = z.object({
  payment_uri: z.string().min(1),
  payment_id: z.string().min(1),
  network: z.enum(["mainnet", "testnet", "regtest"]),
  expiry_height_hint: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.error.message },
      { status: 400 }
    );
  }

  const input: SignPaymentInput = {
    paymentRequest: { scheme: "zip321", value: parsed.data.payment_uri },
    network: parsed.data.network,
    paymentId: parsed.data.payment_id,
    ...(parsed.data.expiry_height_hint === undefined
      ? {}
      : { expiryHeightHint: parsed.data.expiry_height_hint }),
  };

  let signedResult: Awaited<ReturnType<typeof signPayment>>;
  try {
    signedResult = await signPayment(input);
  } catch (err) {
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
    return NextResponse.json(
      {
        error: "settle_failed",
        error_description: err instanceof Error ? err.message : "settle failed",
      },
      { status: 502 }
    );
  }
}
