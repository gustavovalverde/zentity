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

let cached: IdentityClaims | null = null;

export function getCachedIdentity(): IdentityClaims | null {
  return cached;
}

export async function getIdentity(): Promise<IdentityClaims | null> {
  if (cached) {
    return cached;
  }

  const auth = await requireAuth();

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

  cached = claims;
  return cached;
}

/**
 * Redeem a CIBA access token's release_handle for PII.
 * The release endpoint decrypts sealed PII from the approvals table
 * and returns a fresh id_token with identity claims.
 */
export async function redeemRelease(
  cibaAccessToken: string,
  dpopKey: DpopKeyPair
): Promise<IdentityClaims | null> {
  const releaseUrl = `${config.zentityUrl}/api/oauth2/release`;
  let dpopNonce: string | undefined;

  let proof = await createDpopProof(
    dpopKey,
    "POST",
    releaseUrl,
    cibaAccessToken,
    dpopNonce
  );
  let response = await fetch(releaseUrl, {
    method: "POST",
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
      "POST",
      releaseUrl,
      cibaAccessToken,
      dpopNonce
    );
    response = await fetch(releaseUrl, {
      method: "POST",
      headers: { Authorization: `DPoP ${cibaAccessToken}`, DPoP: proof },
    });
  }

  if (!response.ok) {
    console.error(
      `[identity] Release endpoint failed: ${response.status} ${await response.text()}`
    );
    return null;
  }

  const data = (await response.json()) as { id_token?: string };
  if (!data.id_token) {
    console.error("[identity] Release response missing id_token");
    return null;
  }

  const jwtClaims = decodeJwt(data.id_token);
  const claims: IdentityClaims = {
    name: asOptionalString(jwtClaims.name),
    given_name: asOptionalString(jwtClaims.given_name),
    family_name: asOptionalString(jwtClaims.family_name),
    address: asOptionalString(jwtClaims.address),
  };

  // Only return if we actually got identity data
  if (!(claims.name || claims.given_name || claims.family_name)) {
    return null;
  }

  return claims;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
