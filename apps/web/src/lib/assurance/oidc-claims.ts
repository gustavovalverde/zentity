/**
 * OIDC Assurance Claims — Pure mapping functions
 *
 * Maps Zentity's internal assurance model (AccountTier, LoginMethod)
 * to standard OIDC claims (acr, amr) and eIDAS LoA URIs.
 * Also computes at_hash per OIDC Core §3.1.3.6.
 */

import type { AccountTier, LoginMethod } from "./types";

import crypto from "node:crypto";

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

// --- at_hash (Access Token Hash, OIDC Core §3.1.3.6) ---

const ALG_TO_HASH: Record<string, string> = {
  RS256: "sha256",
  ES256: "sha256",
  PS256: "sha256",
  EdDSA: "sha512",
  "ML-DSA-65": "sha256",
};

/**
 * Compute at_hash: base64url-encoded left half of the hash of the
 * access token's ASCII representation.
 *
 * Hash algorithm is determined by the ID token's signing alg.
 * Returns undefined for unknown algorithms (no at_hash emitted).
 */
export function computeAtHash(
  accessToken: string,
  alg: string
): string | undefined {
  const hashAlg = ALG_TO_HASH[alg];
  if (!hashAlg) {
    return undefined;
  }

  const hash = crypto.createHash(hashAlg).update(accessToken, "ascii").digest();
  const leftHalf = hash.subarray(0, hash.length / 2);
  return leftHalf.toString("base64url");
}
