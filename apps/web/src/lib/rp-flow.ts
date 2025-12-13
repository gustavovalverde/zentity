import "server-only";

import { cookies } from "next/headers";

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
export type RpFlowData = {
  clientId: string;
  redirectUri: string;
  state?: string;
  createdAtMs: number;
};

const RP_FLOW_COOKIE_PREFIX = "zentity-rp-flow-";
const RP_FLOW_TTL_SECONDS = 120;

function parseAllowedRedirectUris(): string[] {
  const raw = process.env.RP_ALLOWED_REDIRECT_URIS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedRedirectUri(redirectUri: string): boolean {
  // Allow internal redirects (for first-party testing).
  if (redirectUri.startsWith("/")) return true;

  // Require explicit allowlist for any external redirect.
  const allowlist = parseAllowedRedirectUris();
  return allowlist.includes(redirectUri);
}

export function createRpFlowCookieName(flowId: string): string {
  return `${RP_FLOW_COOKIE_PREFIX}${flowId}`;
}

export async function setRpFlow(
  flowId: string,
  data: RpFlowData,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(createRpFlowCookieName(flowId), btoa(JSON.stringify(data)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: RP_FLOW_TTL_SECONDS,
    path: "/",
  });
}

export async function getRpFlow(flowId: string): Promise<RpFlowData | null> {
  if (!flowId || !/^[0-9a-f-]{36}$/i.test(flowId)) return null;

  const cookieStore = await cookies();
  const cookie = cookieStore.get(createRpFlowCookieName(flowId));
  if (!cookie?.value) return null;

  try {
    const data = JSON.parse(atob(cookie.value)) as RpFlowData;
    if (!data?.createdAtMs || !data.clientId || !data.redirectUri) return null;

    // Extra safety beyond cookie TTL.
    if (Date.now() - data.createdAtMs > RP_FLOW_TTL_SECONDS * 1000) return null;

    return data;
  } catch {
    return null;
  }
}

export async function clearRpFlow(flowId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(createRpFlowCookieName(flowId));
}
