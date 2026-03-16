import { decodeJwt } from "jose";
import { config } from "../config.js";
import { requestCibaApproval } from "./ciba.js";
import { requireAuth } from "./context.js";
import { createDpopProof, type DpopKeyPair, extractDpopNonce } from "./dpop.js";

export interface IdentityClaims {
  address?: string;
  family_name?: string;
  given_name?: string;
  name?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  claims: IdentityClaims;
  expiresAt: number;
}

const identityCache = new Map<string, CacheEntry>();

export function getCachedIdentity(userId?: string): IdentityClaims | null {
  if (!userId) return null;
  const entry = identityCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    identityCache.delete(userId);
    return null;
  }
  return entry.claims;
}

export async function getIdentity(): Promise<IdentityClaims | null> {
  const auth = await requireAuth();
  const userId = auth.loginHint;

  const cached = getCachedIdentity(userId);
  if (cached) return cached;

  const result = await requestCibaApproval({
    cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
    tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
    clientId: auth.clientId,
    dpopKey: auth.dpopKey,
    loginHint: auth.loginHint,
    scope: "openid identity.name identity.address",
    bindingMessage: "Unlock identity for this session",
    resource: config.zentityUrl,
  });

  const claims = await redeemRelease(result.accessToken, auth.dpopKey);
  if (!claims) return null;

  identityCache.set(userId, {
    claims,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return claims;
}

/**
 * Redeem a CIBA access token for PII via the userinfo endpoint.
 */
export async function redeemRelease(
  cibaAccessToken: string,
  dpopKey: DpopKeyPair
): Promise<IdentityClaims | null> {
  const userinfoUrl = `${config.zentityUrl}/api/auth/oauth2/userinfo`;
  let dpopNonce: string | undefined;

  let proof = await createDpopProof(
    dpopKey,
    "GET",
    userinfoUrl,
    cibaAccessToken,
    dpopNonce
  );
  let response = await fetch(userinfoUrl, {
    headers: { Authorization: `DPoP ${cibaAccessToken}`, DPoP: proof },
  });

  const nonce = extractDpopNonce(response);
  if (
    nonce &&
    dpopNonce !== nonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonce = nonce;
    proof = await createDpopProof(
      dpopKey,
      "GET",
      userinfoUrl,
      cibaAccessToken,
      dpopNonce
    );
    response = await fetch(userinfoUrl, {
      headers: { Authorization: `DPoP ${cibaAccessToken}`, DPoP: proof },
    });
  }

  if (!response.ok) {
    console.error(
      `[identity] Userinfo endpoint failed: ${response.status} ${await response.text()}`
    );
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;
  // Zentity userinfo wraps response in { response: { ... } }
  const userinfo = (
    typeof data.response === "object" && data.response !== null
      ? data.response
      : data
  ) as Record<string, unknown>;

  const claims: IdentityClaims = {
    name: asOptionalString(userinfo.name),
    given_name: asOptionalString(userinfo.given_name),
    family_name: asOptionalString(userinfo.family_name),
    address: asOptionalString(userinfo.address),
  };

  if (!(claims.name || claims.given_name || claims.family_name)) {
    return null;
  }

  return claims;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
