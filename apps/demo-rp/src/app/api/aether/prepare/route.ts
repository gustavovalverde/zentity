import { createHash, randomUUID } from "node:crypto";
import {
  intentHash,
  intentHashToWireString,
  networkToChainReference,
  paymentUriToCaip10,
} from "@zentity/sdk/protocol";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { computeUriConfirmationCode } from "@/lib/confirmation-code";
import { signDpopProof } from "@/lib/dpop";
import { env } from "@/lib/env";
import { preparePayment, ZpayError } from "@/lib/zpay-client";

/**
 * POST /api/aether/prepare
 *
 * Server-side proxy that calls zpay `/x402/v2/prepare` BEFORE the
 * Aether agent triggers CIBA. The resulting `payment_uri` +
 * `payment_id` are merged into the CIBA `authorization_details` so
 * the user's phone sees the same prepared URI that the in-page
 * wallet bridge will later display.
 *
 * The BFF derives a 6-character `confirmation_code` from the
 * canonical `payment_uri` (SHA-256, base32-no-pad, uppercase) and
 * returns it in the response. The page forwards the code into the
 * CIBA binding message and the bridge surfaces it above the QR; the
 * user matches the code on phone versus laptop to defeat URI-swap
 * phishing.
 *
 * Errors are discriminated by a machine `error` tag (Commit F):
 *
 * - `session_required` (401) when the caller is not signed in.
 * - `network_error` (502) when the fetch itself throws.
 * - `server_error` (502) when zpay returns a non-2xx.
 * - `registry_unknown` (404) when zpay reports the payee is not
 *   registered with the deployment.
 * - `invalid_request` (400) when the body fails Zod validation.
 *
 * After Commit E zpay requires a DPoP proof on every `/prepare`
 * call; the proof's JWK thumbprint binds the prepared row to this
 * BFF process for the `(jkt, idempotency_key)` idempotency composite.
 * The BFF derives a deterministic idempotency key from
 * `(user_email, task_id, item_id, amount_minor_units)` so honest
 * retries from the same user on the same task collapse onto one
 * prepared row.
 */

const requestSchema = z.object({
  merchant: z.string().min(1),
  item: z.string().min(1),
  network: z.enum(["testnet", "mainnet", "regtest"]).default("testnet"),
  taskId: z.string().min(1),
  itemId: z.string().min(1),
  amountMinorUnits: z.number().int().nonnegative(),
});

const BASE64_PAD_RE = /=+$/;
const BASE64_PLUS_RE = /\+/g;
const BASE64_SLASH_RE = /\//g;
const REGISTRY_UNKNOWN_RE = /payee_id is not registered/i;

function base64url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(BASE64_PAD_RE, "")
    .replace(BASE64_PLUS_RE, "-")
    .replace(BASE64_SLASH_RE, "_");
}

function deriveIdempotencyKey(input: {
  userEmail: string;
  taskId: string;
  itemId: string;
  amountMinorUnits: number;
}): string {
  const canonical = `${input.userEmail}:${input.taskId}:${input.itemId}:${input.amountMinorUnits}`;
  return base64url(createHash("sha256").update(canonical).digest());
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.error.message },
      { status: 400 }
    );
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const userEmail = session?.user?.email;
  if (!(session?.user?.id && userEmail)) {
    return NextResponse.json(
      {
        error: "session_required",
        error_description:
          "Sign in before preparing a payment; the idempotency key is derived from the user identity.",
      },
      { status: 401 }
    );
  }

  const input = parsed.data;
  const idempotencyKey = deriveIdempotencyKey({
    userEmail,
    taskId: input.taskId,
    itemId: input.itemId,
    amountMinorUnits: input.amountMinorUnits,
  });

  const prepareUrl = `${env.ZPAY_URL}/x402/v2/prepare`;
  const { proofJwt } = await signDpopProof({
    method: "POST",
    url: prepareUrl,
    jti: randomUUID(),
  });

  try {
    const prepared = await preparePayment({
      dpopProof: proofJwt,
      payeeId: env.ZPAY_PAYEE_ID,
      network: input.network,
      resourceUri: `aether/items/${input.item}`,
      nonce: idempotencyKey,
      idempotencyKey,
    });

    const chainReference = networkToChainReference(input.network);
    const recipient = paymentUriToCaip10(prepared.payment_uri, chainReference);
    const intentHashWire = intentHashToWireString(
      intentHash({
        chainNamespace: "zcash",
        chainReference,
        recipientCaip10: recipient,
        amountValue: BigInt(prepared.amount_zat),
        amountUnit: "base",
        paymentId: prepared.payment_id,
        expiryHeight: BigInt(prepared.expiry_height),
      })
    );

    return NextResponse.json({
      payment_id: prepared.payment_id,
      payment_uri: prepared.payment_uri,
      expiry_height: prepared.expiry_height,
      amount_zat: prepared.amount_zat,
      confirmation_code: await computeUriConfirmationCode(prepared.payment_uri),
      recipient,
      chain: { namespace: "zcash" as const, reference: chainReference },
      intent_hash: intentHashWire,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "prepare failed";
    const problemKind =
      error instanceof ZpayError && error.problem ? error.kind : null;
    const isRegistryUnknown = problemKind
      ? problemKind === "registry_unknown"
      : REGISTRY_UNKNOWN_RE.test(message);
    if (isRegistryUnknown) {
      return NextResponse.json(
        {
          error: "registry_unknown",
          error_description:
            "The merchant is not registered with the payment service. Reach out to support.",
        },
        { status: 404 }
      );
    }
    if (error instanceof TypeError) {
      // `fetch` throws TypeError on network-layer failures (DNS, TLS,
      // socket reset). Surface as `network_error` so the page can show
      // a retry affordance distinct from upstream-bad-response cases.
      return NextResponse.json(
        {
          error: "network_error",
          error_description: "Could not reach the payment service.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        error: "server_error",
        error_description: message,
      },
      { status: 502 }
    );
  }
}
