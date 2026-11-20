/**
 * Step-Up Authentication: Zentity assurance tiers requested via acr_values.
 *
 * - Pure helpers: parse and evaluate acr_values
 * - Authorize endpoint hook: enforceAuthorizeAcr (PAR + direct GET or POST)
 * - CIBA enforcement: token-exchange safety net (approval-time checks run in
 *   the CIBA approval decision, `oidc/ciba.ts`)
 *
 * For first-party clients, the CIBA token exchange safety net can answer
 * HTTP 403 + auth_session through the first-party-apps plugin, so the client
 * continues at the Authorization Challenge Endpoint instead of the browser.
 */

import type {
  OAuthBeforeAuthorizationInput,
  OAuthBeforeTokenIssuanceInput,
} from "@better-auth/oauth-provider";
import type { AccountTier } from "@zentity/sdk/protocol";

import { challengeFirstPartyStepUpFromIssuance } from "@better-auth/first-party-apps";
import { getIssuer } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";

import { getAccountAssurance } from "@/lib/assurance/posture";
import { oauthProviderOptions } from "@/lib/auth/oidc/oauth-provider";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ACR_TIER_PATTERN = /^urn:zentity:assurance:tier-(\d)$/;
const WHITESPACE = /\s+/;
const IMPLICIT_RESPONSE_TYPE = /\b(token|id_token)\b/;
function parseAcrValues(raw: string): string[] {
  return raw.split(WHITESPACE).filter(Boolean);
}

function extractTierFromAcr(acr: string): number | null {
  const match = ACR_TIER_PATTERN.exec(acr);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Find the first requested ACR that the user's tier satisfies.
 * Higher tiers satisfy lower requirements (tier-3 satisfies tier-2).
 * Takes the space-separated `acr_values` parameter or the values already
 * split. Returns the first satisfiable ACR URI, or null if none are satisfied.
 */
export function findSatisfiedAcr(
  acrValues: string | readonly string[],
  userTier: AccountTier
): string | null {
  const requested =
    typeof acrValues === "string" ? parseAcrValues(acrValues) : acrValues;
  for (const acr of requested) {
    const requestedTier = extractTierFromAcr(acr);
    if (requestedTier !== null && userTier >= requestedTier) {
      return acr;
    }
  }
  return null;
}

export async function enforceAuthorizeAcr({
  ctx,
  session,
  query,
}: OAuthBeforeAuthorizationInput) {
  if (!session || typeof query.acr_values !== "string" || !query.acr_values) {
    return;
  }
  const assurance = await getAccountAssurance(session.user.id, {
    isAuthenticated: true,
  });
  if (findSatisfiedAcr(query.acr_values, assurance.tier)) {
    return;
  }
  const description = `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${query.acr_values}`;
  // beta.11 sends authorization-hook errors in the query even for fragment requests.
  const mode = "response_mode" in query ? query.response_mode : undefined;
  if (
    ctx.path === "/oauth2/authorize" &&
    query.redirect_uri &&
    (mode === "fragment" ||
      (!mode && IMPLICIT_RESPONSE_TYPE.test(query.response_type ?? "")))
  ) {
    const url = new URL(query.redirect_uri);
    const fragment = new URLSearchParams({
      error: "interaction_required",
      error_description: description,
      iss: getIssuer(ctx, oauthProviderOptions(ctx.context)),
    });
    if (query.state) {
      fragment.set("state", query.state);
    }
    url.hash = fragment.toString();
    throw ctx.redirect(url.toString());
  }
  throw new APIError("BAD_REQUEST", {
    error: "interaction_required",
    error_description: description,
  });
}

// The account's assurance can drop between approval and redemption.
export async function enforceCibaTokenAcr(
  issuance: OAuthBeforeTokenIssuanceInput,
  acrValues: readonly string[] = []
) {
  if (!acrValues.length) {
    return;
  }
  if (!issuance.user) {
    throw new Error("CIBA assurance requires the grant's user");
  }
  const assurance = await getAccountAssurance(issuance.user.id, {
    isAuthenticated: true,
  });
  if (findSatisfiedAcr(acrValues, assurance.tier)) {
    return;
  }
  const requested = acrValues.join(" ");
  const description = `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${requested}`;

  // An authorization code cannot preserve the payment's authorization details.
  if (!issuance.authorizationDetails?.length) {
    await challengeFirstPartyStepUpFromIssuance({
      issuance,
      request: {
        scope: issuance.scopes.join(" "),
        ...(issuance.resources?.length ? { resource: issuance.resources } : {}),
        acr_values: requested,
      },
      description,
    });
  }
  throw new APIError("BAD_REQUEST", {
    error: "interaction_required",
    error_description: description,
  });
}
