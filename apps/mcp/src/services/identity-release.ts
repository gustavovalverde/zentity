import type { DpopClient } from "@zentity/sdk/rp";
import { config } from "../config.js";

export interface IdentityClaims {
  address?: string | Record<string, unknown>;
  birthdate?: string;
  family_name?: string;
  given_name?: string;
  name?: string;
}

/**
 * Redeem a CIBA access token for PII via the userinfo endpoint.
 */
export function redeemRelease(
  cibaAccessToken: string,
  dpopClient: Pick<DpopClient, "proofFor" | "withNonceRetry">
): Promise<IdentityClaims | null> {
  const userinfoUrl = `${config.zentityUrl}/api/auth/oauth2/userinfo`;
  return redeemViaDpop(userinfoUrl, cibaAccessToken, dpopClient);
}

async function redeemViaDpop(
  userinfoUrl: string,
  cibaAccessToken: string,
  dpopClient: Pick<DpopClient, "proofFor" | "withNonceRetry">
): Promise<IdentityClaims | null> {
  const { response } = await dpopClient.withNonceRetry(async (nonce) => {
    const proof = await dpopClient.proofFor(
      "GET",
      userinfoUrl,
      cibaAccessToken,
      nonce
    );
    const attemptResponse = await fetch(userinfoUrl, {
      headers: { Authorization: `DPoP ${cibaAccessToken}`, DPoP: proof },
    });
    return { response: attemptResponse, result: null };
  });

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
  const birthdate = asOptionalString(userinfo.birthdate);

  const claims: IdentityClaims = {
    ...(name ? { name } : {}),
    ...(givenName ? { given_name: givenName } : {}),
    ...(familyName ? { family_name: familyName } : {}),
    ...(address ? { address } : {}),
    ...(birthdate ? { birthdate } : {}),
  };

  if (!(name || givenName || familyName || address || birthdate)) {
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
