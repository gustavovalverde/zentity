import "server-only";

import type { X402PurchaseAuthorization } from "@zentity/sdk/protocol";

import { parseScopes } from "@better-auth/oauth-provider/internal";
import {
  findRegisteredAsset,
  isLoopbackHttpUrl,
  PURCHASE_TYPE,
  PurchaseAuthorizationSchema,
  X402_PURCHASE_TYPE,
  X402PurchaseAuthorizationSchema,
} from "@zentity/sdk/protocol";
import { APIError } from "better-auth/api";

import { env } from "@/env";

import { parseAuthorizationDetails } from "./payment-mint";

/**
 * The bc-authorize contract for the `purchase` and `x402_purchase` RAR types.
 *
 * A purchase request carries exactly one entry, re-serialized after its strict
 * schema parses it, so the approval surfaces and the token show the entry
 * that was validated. Its resource is Zentity's own origin, so the token is
 * opaque and never audienced to a merchant. Scopes are refused, never
 * rewritten: the stored scope must equal the sent scope, because the
 * Agent-Assertion `task_hash` covers it.
 */

const POH_SCOPE = "poh";
const PURCHASE_TYPES = new Set<string>([PURCHASE_TYPE, X402_PURCHASE_TYPE]);
const PURCHASE_SCHEMAS = {
  [PURCHASE_TYPE]: PurchaseAuthorizationSchema,
  [X402_PURCHASE_TYPE]: X402PurchaseAuthorizationSchema,
} as const;

function invalidAuthorizationDetails(description: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_authorization_details",
    error_description: description,
  });
}

function invalidScope(description: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_scope",
    error_description: description,
  });
}

function entryType(entry: unknown): string | undefined {
  const type =
    entry && typeof entry === "object"
      ? (entry as { type?: unknown }).type
      : undefined;
  return typeof type === "string" ? type : undefined;
}

function assertPurchaseScopes(type: string, scopes: string[]): void {
  if (type === X402_PURCHASE_TYPE) {
    const unique = new Set(scopes);
    if (!(unique.size === 2 && unique.has("openid") && unique.has(POH_SCOPE))) {
      throw invalidScope("an x402_purchase request has scope openid poh");
    }
    return;
  }
  if (scopes.includes(POH_SCOPE)) {
    throw invalidScope("poh is requested only with an x402_purchase entry");
  }
}

/**
 * Prepares a purchase request at bc-authorize, before the CIBA plugin stores
 * it. A request without a purchase entry is left as it is, unless it asks for
 * `poh`, which only an `x402_purchase` approval yields.
 */
export function pinPurchaseRequest(body: Record<string, unknown>): void {
  const scopes = parseScopes(
    typeof body.scope === "string" ? body.scope : undefined
  );
  const details = parseAuthorizationDetails(body.authorization_details);
  const purchaseEntry = details?.find((entry) =>
    PURCHASE_TYPES.has(entryType(entry) ?? "")
  );
  if (!(details && purchaseEntry !== undefined)) {
    if (scopes.includes(POH_SCOPE)) {
      throw invalidScope("poh is requested only with an x402_purchase entry");
    }
    return;
  }
  if (details.length !== 1) {
    throw invalidAuthorizationDetails(
      "a purchase request carries exactly one authorization_details entry"
    );
  }
  const type = entryType(purchaseEntry) as keyof typeof PURCHASE_SCHEMAS;
  const parsed = PURCHASE_SCHEMAS[type].safeParse(purchaseEntry);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalidAuthorizationDetails(
      issue
        ? `${type}: ${issue.path.join(".") || "entry"}: ${issue.message}`
        : `authorization_details is not a valid ${type} request`
    );
  }
  assertPurchaseScopes(type, scopes);
  body.authorization_details = JSON.stringify([parsed.data]);
  body.resource = new URL(env.NEXT_PUBLIC_APP_URL).origin;
}

/**
 * What the `x402_purchase` type checks beyond its schema: the payment asset is
 * one Zentity registers, and a loopback `http` resource is for development
 * only.
 */
export function acceptsX402Purchase(
  detail: X402PurchaseAuthorization
): boolean {
  const { network, asset } = detail.payment_requirements;
  if (!findRegisteredAsset(network, asset)) {
    return false;
  }
  return !(
    process.env.NODE_ENV === "production" &&
    isLoopbackHttpUrl(detail.resource_url)
  );
}
