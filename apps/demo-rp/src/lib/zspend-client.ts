import "server-only";

import { env } from "@/lib/env";

/**
 * Server-side wrapper for zspend-runtime's HTTP surface.
 *
 * The Aether BFF orchestrator at /api/aether/sign calls
 * `signPayment(paymentRequest, network, paymentId)` to obtain a
 * `signed_payload` from the wallet runtime. The returned bytes are
 * hex-encoded by the BFF and forwarded to zpay /x402/v2/settle.
 *
 * Per Proposal-0003 Phase 4: zspend-runtime authenticates with DPoP +
 * at+jwt; the Phase 4 MVP skips that verification in zspend, so this
 * client likewise omits auth headers and posts plain JSON. Phase 4 MVP
 * also ships `format: "raw-zcash-v5"` instead of `"pczt-v1"` (since
 * Phase 2d's PCZT methods are not yet in zally); the BFF unwraps the
 * envelope into a hex string regardless.
 */

export interface SignedPayloadEnvelope {
  bytes: string;
  expires_at:
    | { kind: "block_height"; value: number }
    | { kind: "slot"; value: number }
    | { kind: "block_number"; value: number }
    | { kind: "timestamp_seconds"; value: number };
  fee: { currency: string; value: string; unit: "base" | "display" };
  format: string;
  metadata?: Record<string, unknown>;
  tx_id: string;
}

export interface SignPaymentInput {
  expiryHeightHint?: number;
  network: "mainnet" | "testnet" | "regtest";
  paymentId: string;
  paymentRequest: { scheme: "zip321"; value: string };
}

export interface SignPaymentResult {
  signedPayload: SignedPayloadEnvelope;
}

export async function signPayment(
  input: SignPaymentInput
): Promise<SignPaymentResult> {
  const baseUrl = env.ZSPEND_URL;
  const response = await fetch(`${baseUrl}/v1/payments/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payment_request: input.paymentRequest,
      network: input.network,
      payment_id: input.paymentId,
      ...(input.expiryHeightHint === undefined
        ? {}
        : { expiry_height_hint: input.expiryHeightHint }),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `zspend /v1/payments/sign returned ${response.status}: ${detail}`
    );
  }

  const body = (await response.json()) as {
    signed_payload?: SignedPayloadEnvelope;
  };
  if (!body.signed_payload) {
    throw new Error("zspend response missing signed_payload");
  }
  return { signedPayload: body.signed_payload };
}

/**
 * Decodes the base64 `bytes` field on a `SignedPayloadEnvelope` into a hex
 * string for forwarding to zpay's `/x402/v2/settle` (which still consumes
 * `raw_tx_hex` until Phase 2g lands the wire change).
 */
export function signedPayloadBytesToHex(
  envelope: SignedPayloadEnvelope
): string {
  return Buffer.from(envelope.bytes, "base64").toString("hex");
}
