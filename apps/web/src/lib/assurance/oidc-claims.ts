/**
 * OIDC Assurance Claims — Pure mapping functions
 *
 * Maps Zentity's internal assurance model (AccountTier, LoginMethod)
 * to standard OIDC claims (acr, amr) and eIDAS LoA URIs.
 */

import type {
  AccountAssurance,
  AccountTier,
  AuthenticationState,
  LoginMethod,
} from "@zentity/sdk/protocol";

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

function computeAcrEidas(tier: AccountTier): string {
  return EIDAS_URIS[tier];
}

/**
 * Namespaced id-token assurance claim. The OAuth provider owns the standard
 * `acr`/`amr`/`auth_time` id-token claims, which it fills from the
 * authentication context Zentity resolves at approval; this claim adds the
 * eIDAS level of assurance that has no standard claim.
 */
const ASSURANCE_CLAIM = "zentity_assurance";

export function buildNamespacedAssuranceClaim(
  assurance: Pick<AccountAssurance, "tier">,
  auth: Pick<AuthenticationState, "amr">
) {
  return {
    [ASSURANCE_CLAIM]: {
      acr: computeAcr(assurance.tier),
      acr_eidas: computeAcrEidas(assurance.tier),
      ...(auth.amr.length > 0 ? { amr: auth.amr } : {}),
    },
  };
}

// --- AMR (Authentication Methods References, RFC 8176) ---

/**
 * Only methods Zentity observed. A passkey proves possession (`pop`) and user
 * presence (`user`); with the authenticator's user-verified flag it is also a
 * second factor (`mfa`). `hwk` is never claimed, since registration accepts
 * any authenticator without attestation.
 */
const AMR_MAP: Record<Exclude<LoginMethod, "passkey">, string[]> = {
  opaque: ["pwd"],
  "magic-link": ["otp"],
  oauth: [],
  eip712: ["pop"],
  credential: ["pwd"],
};

export function loginMethodToAmr(
  method: LoginMethod | "none" | null | undefined,
  observed: { userVerified?: boolean } = {}
): string[] {
  if (method === "passkey") {
    return observed.userVerified ? ["pop", "user", "mfa"] : ["pop", "user"];
  }
  if (!(method && method in AMR_MAP)) {
    return [];
  }
  return [...AMR_MAP[method as keyof typeof AMR_MAP]];
}
