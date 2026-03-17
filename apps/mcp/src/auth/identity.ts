import { config } from "../config.js";
import { requestCibaApproval } from "./ciba.js";
import { requireAuth } from "./context.js";
import { createDpopProof, type DpopKeyPair, extractDpopNonce } from "./dpop.js";

export interface IdentityClaims {
  address?: string | Record<string, unknown>;
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
  if (!userId) {
    return null;
  }
  const entry = identityCache.get(userId);
  if (!entry) {
    return null;
  }
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
  if (cached) {
    return cached;
  }

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
  if (!claims) {
    return null;
  }

  identityCache.set(userId, {
    claims,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return claims;
}

/**
 * Redeem a CIBA access token for PII via the userinfo endpoint.
 */
export function redeemRelease(
  cibaAccessToken: string,
  dpopKey: DpopKeyPair
): Promise<IdentityClaims | null> {
  const userinfoUrl = `${config.zentityUrl}/api/auth/oauth2/userinfo`;
  return redeemViaDpop(userinfoUrl, cibaAccessToken, dpopKey);
}

async function redeemViaDpop(
  userinfoUrl: string,
  cibaAccessToken: string,
  dpopKey: DpopKeyPair
): Promise<IdentityClaims | null> {
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

  return parseUserinfoResponse(response);
}

async function parseUserinfoResponse(
  response: Response
): Promise<IdentityClaims | null> {
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

  const name = asOptionalString(userinfo.name);
  const givenName = asOptionalString(userinfo.given_name);
  const familyName = asOptionalString(userinfo.family_name);
  const address = asOptionalAddress(userinfo.address);

  const claims: IdentityClaims = {
    ...(name ? { name } : {}),
    ...(givenName ? { given_name: givenName } : {}),
    ...(familyName ? { family_name: familyName } : {}),
    ...(address ? { address } : {}),
  };

  if (!(name || givenName || familyName)) {
    return null;
  }

  return claims;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalAddress(
  value: unknown
): string | Record<string, unknown> | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
