import "server-only";

import {
  PAYMENT_AUTHORIZATION_CAPABILITY,
  PAYMENT_AUTHORIZATION_TYPE,
  type PaymentAuthorization,
  PaymentAuthorizationDetailsSchema,
} from "@zentity/sdk/protocol";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

/**
 * One home for the `payment_authorization` token contract (PRD-43 Phase 1).
 *
 * A payment token differs from every other token zentity mints in three ways
 * the wallet checks: it carries exactly one canonical `payment_authorization`
 * RAR, its `aud` is the wallet's absolute-URI identity (e.g.
 * `urn:zentity:wallet:<jkt>`), and it lives 120 seconds. The oauth-provider
 * hard-sets `aud` and `exp` AFTER our claims hook runs, so those two are pinned
 * through native OAuth seams (a resource indicator and a per-scope lifetime)
 * while the RAR is minted in the claims hook. This module owns all three so the
 * wiring reads as one decision instead of three scattered edits.
 *
 * Trust note: the bc-authorize before-hook (canonicalizePaymentRar) overwrites
 * ctx.body.authorization_details with the canonical string BEFORE the CIBA
 * plugin persists it, so both the JWT claims copy (re-emitted here) and the
 * token response-body copy derive from the canonical RAR, not a client echo.
 * The wallet enforces the RAR from the signed JWT regardless.
 */

/**
 * The OAuth scope a payment token carries. Deliberately equal to the capability
 * name: one identifier, two enforcement layers — as a scope it drives the 120 s
 * lifetime via `scopeExpirations`; as a capability it drives boundary/ledger
 * evaluation.
 */
export const PAYMENT_AUTHORIZATION_SCOPE = PAYMENT_AUTHORIZATION_CAPABILITY;

/**
 * Per-scope lifetime (D-6): only tokens granted the payment scope shorten to
 * 120 s; everything else keeps the global 3600 s. The value is a DURATION
 * STRING, not a number — oauth-provider's `toExpJWT` treats a number as an
 * absolute epoch timestamp (which would mint an already-expired token).
 */
export const PAYMENT_TOKEN_SCOPE_EXPIRATIONS: Record<string, string> = {
  [PAYMENT_AUTHORIZATION_SCOPE]: "120s",
};

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

function parseAuthorizationDetails(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function hasPaymentEntry(details: unknown[] | null): boolean {
  return (
    details?.some(
      (entry) =>
        (entry as { type?: unknown } | null)?.type ===
        PAYMENT_AUTHORIZATION_TYPE
    ) ?? false
  );
}

/**
 * Validate + canonicalize a payment RAR at bc-authorize (D-14). Returns the
 * canonical JSON string to persist when the request is a payment grant, `null`
 * when it carries no payment entry (leave other RAR types untouched), and
 * throws `invalid_request` when a payment RAR is malformed or not exactly one
 * entry. Persisting the canonical form (not the raw client string) is what lets
 * "displayed equals signed" hold for the push card and the mint.
 */
export function canonicalizePaymentRar(raw: unknown): string | null {
  const details = parseAuthorizationDetails(raw);
  if (!hasPaymentEntry(details)) {
    return null;
  }
  const result = PaymentAuthorizationDetailsSchema.safeParse(details);
  if (!result.success) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description:
        result.error.issues[0]?.message ??
        "authorization_details is not a valid payment_authorization request",
    });
  }
  return JSON.stringify(result.data);
}

/**
 * Mint claims (D-1): re-validate the persisted RAR and emit it as
 * `authorization_details`. The CIBA grant handler `Object.assign`s this return
 * over its client echo, so the JWT carries the canonical RAR. A corrupt stored
 * RAR throws — failing the mint loudly rather than minting a token without
 * `authorization_details`.
 */
export function buildPaymentAuthorizationClaims(
  authorizationDetailsRaw: unknown
): { authorization_details: PaymentAuthorization[] } | null {
  const details = parseAuthorizationDetails(authorizationDetailsRaw);
  if (!hasPaymentEntry(details)) {
    return null;
  }
  const result = PaymentAuthorizationDetailsSchema.safeParse(details);
  if (!result.success) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_grant",
      error_description: `stored payment_authorization is invalid: ${
        result.error.issues[0]?.message ?? "unknown"
      }`,
    });
  }
  return { authorization_details: result.data };
}

/**
 * Pin `aud` to the wallet's absolute-URI identity for a CIBA payment-token
 * request (D-5). Mutates `body.resource` so the resource indicator resolves to
 * the wallet audience as `aud`. Must run AFTER `beforeTokenPairwiseGuard`
 * (agent clients default to pairwise, and that guard strips the resource). The
 * issuer pins the resource itself rather than trusting the client, so the
 * audience is authoritative. Fails closed when `WALLET_AUDIENCE` is unset
 * rather than minting an unbound spend token.
 */
export async function pinPaymentTokenAudience(
  body: Record<string, unknown>
): Promise<void> {
  if (body.grant_type !== CIBA_GRANT_TYPE) {
    return;
  }
  const authReqId =
    typeof body.auth_req_id === "string" ? body.auth_req_id : null;
  if (!authReqId) {
    return;
  }
  const row = await db
    .select({ authorizationDetails: cibaRequests.authorizationDetails })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .limit(1)
    .get();
  if (!hasPaymentEntry(parseAuthorizationDetails(row?.authorizationDetails))) {
    return;
  }
  const walletAudience = env.WALLET_AUDIENCE;
  if (!walletAudience) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      error: "server_error",
      error_description:
        "WALLET_AUDIENCE is not configured; refusing to mint a payment_authorization token without a wallet audience",
    });
  }
  body.resource = walletAudience;
}
