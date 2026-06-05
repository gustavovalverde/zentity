import "server-only";

import { env } from "@/lib/env";

/**
 * Server-side wrapper for zpay's HTTP surface.
 *
 * - `preparePayment` posts to `/x402/v2/prepare` and returns the
 *   bare `Preparation` payload (payment_id, payment_uri, amount_zat,
 *   expiry_height, memo_bytes).
 * - `getPaymentStatus` reads the canonical snapshot via
 *   `/x402/v2/payments/{id}` (bridge polling fallback).
 * - `proxyPaymentEvents` pipes the upstream SSE stream from
 *   `/x402/v2/payments/{id}/events` through the demo-rp domain so the
 *   browser EventSource never talks to zpay directly. The Next.js
 *   route handler that wires this MUST set `runtime = "nodejs"` and
 *   `dynamic = "force-dynamic"` so the platform never buffers or
 *   caches the response.
 * The 6-character payment confirmation code is derived by
 * `computeUriConfirmationCode` in `@/lib/confirmation-code`. Importers
 * should pull it from there directly; the helper is intentionally
 * client-safe so the in-page bridge can re-derive without dragging in
 * this server-only module.
 *
 * Field names match zpay's wire vocabulary (snake_case) instead of
 * being re-cased to camelCase. The wire shape is the contract; the
 * bridge UI reads `event.data` as one of these snapshots verbatim.
 *
 * Status vocabulary as of Commit F (`PaymentStatus`):
 *
 * - `awaiting`: prepared row exists, no settlement yet.
 * - `broadcast`: settlement ledger has a success-kind outcome but the
 *   oracle has not seen the tx in a block.
 * - `mined`: oracle has observed `confirmation_count >= 1`.
 * - `final`: oracle has observed `confirmation_count >= ZPAY_FINALITY_DEPTH`.
 * - `failed`: settle attempt landed a failure-kind outcome.
 * - `never_issued`: payment_id never reached zpay.
 * - `expired`: prepared row expired before any settlement landed.
 */

export type PaymentNetwork = "testnet" | "mainnet" | "regtest";

export type PaymentStatus =
  | "awaiting"
  | "broadcast"
  | "mined"
  | "final"
  | "failed"
  | "never_issued"
  | "expired";

export type IntentPosture =
  | "unverified"
  | "verify_in_flight"
  | "verified"
  | "verification_failed";

export type BroadcastOutcome =
  | { kind: "accepted"; transaction_id: string }
  | { kind: "duplicate"; upstream_message: string }
  | { kind: "invalid_encoding"; upstream_message: string }
  | { kind: "rejected"; upstream_message: string }
  | { kind: "unknown"; upstream_message: string };

export interface PaymentStatusSnapshot {
  broadcast_outcome: BroadcastOutcome | null;
  confirmation_count: number | null;
  intent_posture: IntentPosture;
  mined_block_height: number | null;
  payment_id: string;
  settled_at_unix_seconds: number | null;
  status: PaymentStatus;
}

export interface Preparation {
  amount_zat: number;
  expiry_height: number;
  memo_bytes: number[];
  payment_id: string;
  payment_uri: string;
}

export interface PreparePaymentInput {
  /**
   * DPoP proof JWT minted for this exact request. zpay requires every
   * `POST /x402/v2/prepare` call to carry a valid `DPoP` header; the
   * proof's JWK thumbprint becomes the first half of the
   * `(jkt, idempotency_key)` idempotency composite stored on the
   * prepared row.
   */
  dpopProof: string;
  /**
   * Optional evidence-pack hash (32 raw bytes) binding the payment to
   * a zentity proof set. zpay grows the protocol memo from 66 to 98
   * bytes when this is present.
   */
  evidencePackHash?: number[];
  idempotencyKey: string;
  network: PaymentNetwork;
  /**
   * Nonce that uniquifies the challenge inside the
   * `(jkt, idempotencyKey)` scope. Stored verbatim on the wire and
   * folded into zpay's challenge hash server-side.
   */
  nonce: string;
  payeeId: string;
  /**
   * Resource URL the agent advertised to the payer. Stored verbatim
   * on the wire and folded into both the challenge and resource
   * hashes server-side; the BFF never pre-hashes it.
   */
  resourceUri: string;
}

export async function preparePayment(
  input: PreparePaymentInput
): Promise<Preparation> {
  const baseUrl = env.ZPAY_URL;
  const body: Record<string, unknown> = {
    payee_id: input.payeeId,
    network: input.network,
    scheme: "zcash" as const,
    resource_uri: input.resourceUri,
    nonce: input.nonce,
    idempotency_key: input.idempotencyKey,
  };
  if (input.evidencePackHash) {
    body.evidence_pack_hash = input.evidencePackHash;
  }

  const response = await fetch(`${baseUrl}/x402/v2/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      DPoP: input.dpopProof,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `zpay /x402/v2/prepare returned ${response.status}: ${detail}`
    );
  }

  const preparation = (await response.json()) as Preparation;
  if (!(preparation.payment_id && preparation.payment_uri)) {
    throw new Error("zpay /x402/v2/prepare response missing payment_id/uri");
  }
  return preparation;
}

export interface SettlePaymentInput {
  /** DPoP proof minted for `POST {ZPAY_URL}/x402/v2/settle`. */
  dpopProof: string;
  paymentId: string;
  /** Hex-encoded signed v5 Zcash transaction. */
  rawTxHex: string;
}

export interface SettlementResponse {
  broadcast_outcome: {
    kind:
      | "accepted"
      | "duplicate"
      | "invalid_encoding"
      | "rejected"
      | "unknown";
    transaction_id?: string;
    upstream_message?: string;
  };
  payment_id: string;
  watch_id?: string | null;
}

/**
 * Forwards a wallet-signed transaction to zpay's `/x402/v2/settle`. The BFF
 * orchestrator at `/api/aether/sign` calls this after obtaining the signed
 * bytes from `zspend-runtime`.
 */
export async function settlePayment(
  input: SettlePaymentInput
): Promise<SettlementResponse> {
  const baseUrl = env.ZPAY_URL;
  const response = await fetch(`${baseUrl}/x402/v2/settle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      DPoP: input.dpopProof,
    },
    body: JSON.stringify({
      payment_id: input.paymentId,
      raw_tx_hex: input.rawTxHex,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `zpay /x402/v2/settle returned ${response.status}: ${detail}`
    );
  }
  return (await response.json()) as SettlementResponse;
}

export async function getPaymentStatus(
  paymentId: string
): Promise<PaymentStatusSnapshot> {
  const baseUrl = env.ZPAY_URL;
  const response = await fetch(
    `${baseUrl}/x402/v2/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) {
    throw new Error(
      `zpay /x402/v2/payments/${paymentId} returned ${response.status}`
    );
  }
  const snapshot = (await response.json()) as PaymentStatusSnapshot;
  if (!snapshot.payment_id) {
    throw new Error("zpay status response missing payment_id");
  }
  return snapshot;
}

/**
 * Pipe zpay's SSE stream through this server so the browser
 * EventSource never sees zpay's URL. The upstream response body is
 * returned as-is; anti-buffering headers are re-applied at the proxy
 * boundary because Next.js / reverse-proxy hops may add buffering
 * defaults that swallow streaming responses.
 *
 * The caller's request signal is forwarded as the fetch abort signal
 * so a client disconnect cleanly tears down the upstream connection.
 */
export async function proxyPaymentEvents(
  paymentId: string,
  request: Request
): Promise<Response> {
  const baseUrl = env.ZPAY_URL;
  const upstream = await fetch(
    `${baseUrl}/x402/v2/payments/${encodeURIComponent(paymentId)}/events`,
    {
      signal: request.signal,
      headers: { Accept: "text/event-stream" },
    }
  );
  if (!(upstream.ok && upstream.body)) {
    return new Response(
      JSON.stringify({
        error: "zpay_events_unavailable",
        error_description: `zpay events stream returned ${upstream.status}`,
      }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      }
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
