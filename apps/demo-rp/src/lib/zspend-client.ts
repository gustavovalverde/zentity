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

export interface ZspendProblem {
  detail?: string;
  kind: string;
  retryable?: boolean;
  title: string;
}

/**
 * Mirrors zspend-runtime's PRC-7807 envelope (kind/title/detail/retryable).
 * Identical shape to `ZpayProblem` in `zpay-client.ts`; a future slice can
 * lift the parser into a shared `problem-json.ts` module once a third
 * remote-service client lands.
 */
async function parseZspendProblem(
  response: Response
): Promise<ZspendProblem | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/problem+json")) {
    return null;
  }
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!(parsed && typeof parsed === "object")) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "unknown";
  const title = typeof body.title === "string" ? body.title : "zspend error";
  const problem: ZspendProblem = { kind, title };
  if (typeof body.detail === "string") {
    problem.detail = body.detail;
  }
  if (typeof body.retryable === "boolean") {
    problem.retryable = body.retryable;
  }
  return problem;
}

export class ZspendError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly problem: ZspendProblem | null;

  constructor(args: {
    endpoint: string;
    status: number;
    problem: ZspendProblem | null;
    message: string;
  }) {
    super(args.message);
    this.name = "ZspendError";
    this.endpoint = args.endpoint;
    this.status = args.status;
    this.problem = args.problem;
  }

  get kind(): string {
    return this.problem?.kind ?? "unknown";
  }
}

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
  network: "mainnet" | "testnet" | "regtest";
  paymentId: string;
  paymentRequest: { scheme: "zip321"; value: string };
  /**
   * Caller-supplied expiry height the wallet must commit to. Pass the value
   * zpay returned from `/x402/v2/prepare`; the wallet rejects values at or
   * below its observed chain tip with `target_expiry_stale` (HTTP 409).
   */
  targetExpiryHeight: number;
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
      target_expiry_height: input.targetExpiryHeight,
    }),
  });

  if (!response.ok) {
    const problem = await parseZspendProblem(response);
    if (problem) {
      const tail = problem.detail ? `: ${problem.detail}` : "";
      throw new ZspendError({
        endpoint: "/v1/payments/sign",
        status: response.status,
        problem,
        message: `zspend /v1/payments/sign returned ${response.status} [${problem.kind}] ${problem.title}${tail}`,
      });
    }
    const detail = await response.text().catch(() => "");
    throw new ZspendError({
      endpoint: "/v1/payments/sign",
      status: response.status,
      problem: null,
      message: `zspend /v1/payments/sign returned ${response.status}: ${detail}`,
    });
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
