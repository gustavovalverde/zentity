/**
 * Step-Up Authentication — OIDC acr_values and max_age enforcement
 *
 * Pure functions for step-up authentication per OIDC Core §3.1.2.1.
 * Separated from auth.ts to keep the enforcement logic testable.
 */

import type { AccountTier } from "@/lib/assurance/types";

const ACR_TIER_PATTERN = /^urn:zentity:assurance:tier-(\d)$/;
const WHITESPACE = /\s+/;

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
 * Returns the first satisfiable ACR URI, or null if none are satisfied.
 */
export function findSatisfiedAcr(
  acrValuesParam: string,
  userTier: AccountTier
): string | null {
  const requested = parseAcrValues(acrValuesParam);
  for (const acr of requested) {
    const requestedTier = extractTierFromAcr(acr);
    if (requestedTier !== null && userTier >= requestedTier) {
      return acr;
    }
  }
  return null;
}

/**
 * Check if the session age exceeds max_age seconds.
 * max_age=0 always returns true (force re-auth).
 */
export function isMaxAgeExceeded(
  sessionCreatedAt: string | Date,
  maxAge: number
): boolean {
  const authTime = Math.floor(new Date(sessionCreatedAt).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  return now - authTime >= maxAge;
}

/**
 * Build an OAuth error redirect URL with error, description, and state.
 */
export function buildOAuthErrorUrl(
  redirectUri: string,
  state: string | undefined,
  error: string,
  errorDescription: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", errorDescription);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}
