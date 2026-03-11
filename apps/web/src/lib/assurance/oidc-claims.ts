/**
 * OIDC Assurance Claims — Pure mapping functions
 *
 * Maps Zentity's internal assurance model (AccountTier, LoginMethod)
 * to standard OIDC claims (acr, amr) and eIDAS LoA URIs.
 */

import type { AccountTier, LoginMethod } from "./types";

// --- ACR (Authentication Context Class Reference) ---

const ACR_URIS = {
  0: "urn:zentity:assurance:tier-0",
  1: "urn:zentity:assurance:tier-1",
  2: "urn:zentity:assurance:tier-2",
  3: "urn:zentity:assurance:tier-3",
} as const satisfies Record<AccountTier, string>;

export const ACR_VALUES_SUPPORTED = Object.values(ACR_URIS);

export function computeAcr(tier: AccountTier): string {
  return ACR_URIS[tier];
}

// --- eIDAS Level of Assurance ---

const EIDAS_URIS = {
  0: "http://eidas.europa.eu/LoA/low",
  1: "http://eidas.europa.eu/LoA/low",
  2: "http://eidas.europa.eu/LoA/substantial",
  3: "http://eidas.europa.eu/LoA/high",
} as const satisfies Record<AccountTier, string>;

export function computeAcrEidas(tier: AccountTier): string {
  return EIDAS_URIS[tier];
}

// --- AMR (Authentication Methods References, RFC 8176) ---

const AMR_MAP: Record<LoginMethod | "none", string[]> = {
  passkey: ["pop", "hwk", "user"],
  opaque: ["pwd"],
  "magic-link": ["otp"],
  eip712: ["pop", "hwk"],
  anonymous: ["user"],
  credential: ["pwd"],
  none: ["user"],
};

export function loginMethodToAmr(
  method: LoginMethod | "none" | null | undefined
): string[] {
  if (!(method && method in AMR_MAP)) {
    return AMR_MAP.none;
  }
  return AMR_MAP[method as keyof typeof AMR_MAP];
}
