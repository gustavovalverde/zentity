import "server-only";

import { parseSigned } from "hono/utils/cookie";
import { headers } from "next/headers";

import { getBetterAuthSecret } from "@/lib/utils/env";

/** Validates UUID format (36 chars with hyphens: 8-4-4-4-12) */
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

/**
 * RP Redirect Flow (OAuth-style)
 *
 * This module supports an OAuth-like relying party (RP) handoff:
 * - `/api/rp/authorize` validates `client_id` + `redirect_uri` and creates a short-lived `flow`
 * - The user is redirected to a clean URL (`/rp/verify?flow=...`)
 * - Flow state is stored in an httpOnly cookie for a short TTL (to avoid leaking params in URL/history)
 * - After verification, `/api/rp/complete` issues a one-time code and redirects back to the RP
 *
 * NOTE: This is not a full OAuth/OIDC provider implementation (no PKCE/client secrets/scopes).
 * It's meant for closed-beta style integrations where we want:
 * - clean URLs (no sensitive params in address bar)
 * - open-redirect protection via an allowlist
 * - a minimal server-to-server code exchange for non-PII verification flags
 */
interface RpFlowData {
  clientId: string;
  redirectUri: string;
  state?: string;
  createdAtMs: number;
}

const RP_FLOW_COOKIE_PREFIX = "zentity-rp-flow-";
/** Flow expires after 2 minutes - user must complete verification quickly. */
export const RP_FLOW_TTL_SECONDS = 120;

/** Returns the secret used to sign RP flow cookies. */
export function getRpFlowCookieSecret(): string {
  return getBetterAuthSecret();
}

/** Serializes flow data to a cookie-safe base64 JSON string. */
export function serializeRpFlowCookieValue(data: RpFlowData): string {
  return btoa(JSON.stringify(data));
}

/**
 * Parses and validates a flow cookie value.
 * Returns null if invalid, malformed, or expired.
 */
function parseRpFlowCookieValue(value: string): RpFlowData | null {
  try {
    const data = JSON.parse(atob(value)) as RpFlowData;
    if (!(data?.createdAtMs && data.clientId && data.redirectUri)) {
      return null;
    }

    // Extra safety beyond cookie TTL.
    if (Date.now() - data.createdAtMs > RP_FLOW_TTL_SECONDS * 1000) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/** Parses comma-separated allowlist from RP_ALLOWED_REDIRECT_URIS env var. */
function parseAllowedRedirectUris(): string[] {
  const raw = process.env.RP_ALLOWED_REDIRECT_URIS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Validates redirect URI against allowlist to prevent open redirects.
 * Internal paths (starting with "/") are always allowed.
 */
export function isAllowedRedirectUri(redirectUri: string): boolean {
  if (redirectUri.startsWith("/")) {
    return true;
  }
  const allowlist = parseAllowedRedirectUris();
  return allowlist.includes(redirectUri);
}

/** Creates the cookie name for a specific flow ID. */
export function createRpFlowCookieName(flowId: string): string {
  return `${RP_FLOW_COOKIE_PREFIX}${flowId}`;
}

/**
 * Retrieves and validates RP flow data from signed cookie.
 * Returns null if flow doesn't exist, is invalid, or has expired.
 */
export async function getRpFlow(flowId: string): Promise<RpFlowData | null> {
  if (!(flowId && UUID_PATTERN.test(flowId))) {
    return null;
  }

  const cookieHeader = (await headers()).get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const cookieName = createRpFlowCookieName(flowId);
  const parsed = await parseSigned(
    cookieHeader,
    getRpFlowCookieSecret(),
    cookieName
  );
  const signedValue = parsed[cookieName];
  if (typeof signedValue !== "string" || !signedValue) {
    return null;
  }

  return parseRpFlowCookieValue(signedValue);
}
