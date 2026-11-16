import "server-only";

import { parseClientMetadata } from "@better-auth/oauth-provider/internal";
import {
  PAYMENT_AUTHORIZATION_TYPE,
  PaymentAuthorizationDetailsSchema,
} from "@zentity/sdk/protocol";
import { APIError } from "better-auth/api";

import { env } from "@/env";

import { refuseWalletAudience } from "./haip/resource-metadata";

/**
 * One home for the `payment_authorization` token contract (PRD-43 Phase 1).
 *
 * A payment token differs from every other token zentity mints in three ways
 * the wallet checks: it carries exactly one canonical `payment_authorization`
 * RAR, its `aud` is the wallet's absolute-URI identity (e.g.
 * `urn:zentity:wallet:<jkt>`), and it lives 120 seconds. All three are pinned
 * through native OAuth seams: the RAR and the resource indicator here at
 * bc-authorize, and the lifetime as the wallet resource's `accessTokenTtl`
 * (`getProtectedResourceAudiences`). No scope is involved: a payment client
 * registers `authorization_details_types: ["payment_authorization"]`.
 *
 * Trust note: the bc-authorize before-hook (pinPaymentRequest) overwrites
 * ctx.body.authorization_details and ctx.body.resource BEFORE the CIBA plugin
 * validates and stores them. The plugin issues the stored details unchanged in
 * the JWT and the token response, and binds `aud` to the stored resource, so
 * all three derive from issuer-set values, not a client echo. The wallet
 * enforces the RAR from the signed JWT regardless.
 */

// RFC 9396 §10 client metadata, stored by the CIBA plugin in the client's
// metadata. The plugin keeps its reader private (upstream ask U17).
const AUTHORIZATION_DETAILS_TYPES_FIELD = "authorization_details_types";

/** Whether a client registered the `payment_authorization` RAR type. */
export function registersPaymentAuthorization(
  metadata: string | object | undefined
): boolean {
  const types =
    parseClientMetadata(metadata)?.[AUTHORIZATION_DETAILS_TYPES_FIELD];
  return Array.isArray(types) && types.includes(PAYMENT_AUTHORIZATION_TYPE);
}

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
 * Prepare a backchannel payment request at bc-authorize, before the CIBA plugin
 * persists it.
 *
 * - A request without a payment entry is left untouched, unless it names the
 *   wallet audience, which is refused with `invalid_target`.
 * - D-14: the RAR is validated and replaced with its canonical JSON, so
 *   "displayed equals signed" holds for the push card and the mint. A malformed
 *   entry, or more than one entry, is refused with
 *   `invalid_authorization_details` (RFC 9396 §5).
 * - D-5: the resource is replaced with `WALLET_AUDIENCE`. The plugin issues the
 *   token for the stored resource, so the issuer, not the client, sets `aud`.
 *   The request fails closed when `WALLET_AUDIENCE` is unset rather than minting
 *   an unbound spend token.
 */
export function pinPaymentRequest(body: Record<string, unknown>): void {
  const details = parseAuthorizationDetails(body.authorization_details);
  if (!hasPaymentEntry(details)) {
    refuseWalletAudience(body.resource);
    return;
  }
  const result = PaymentAuthorizationDetailsSchema.safeParse(details);
  if (!result.success) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_authorization_details",
      error_description:
        result.error.issues[0]?.message ??
        "authorization_details is not a valid payment_authorization request",
    });
  }
  const walletAudience = env.WALLET_AUDIENCE;
  if (!walletAudience) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      error: "server_error",
      error_description:
        "WALLET_AUDIENCE is not configured; refusing to authorize a payment without a wallet audience",
    });
  }
  body.authorization_details = JSON.stringify(result.data);
  body.resource = walletAudience;
}
