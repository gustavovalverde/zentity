/**
 * Canonical user-facing terminology.
 *
 * Maps internal/protocol identifiers to plain-language labels shown in the UI.
 * Components import from here instead of hardcoding display strings.
 * This is NOT an i18n system — just a flat mapping to prevent terminology drift.
 */

// ---------------------------------------------------------------------------
// Global terminology mapping (PRD-20 §Global terminology standardization)
// ---------------------------------------------------------------------------

export const TERMINOLOGY = {
  liveness: "selfie check",
  livenessCapitalized: "Selfie Check",
  proofs: "verification records",
  proofsCapitalized: "Verification Records",
  fheKeys: "encryption keys",
  fheKeysCapitalized: "Encryption Keys",
  commitments: "verification data",
  claims: "verified facts",
  credential: "sign-in method",
  tier: "verification level",
  enrollment: "setup",
  binding: "linking",
  bindingPast: "connected",
  prfExtension: "passkey encryption features",
  sybilResistant: "unique person verified",
  sybilResistantCapitalized: "Unique Person",
  identityBound: "linked to your account",
  identityBoundCapitalized: "Linked to Account",
  verifiableCredentials: "Digital ID",
  livenessBadge: "Selfie Check",
} as const;

// ---------------------------------------------------------------------------
// Scope group labels — consent UI grouping
// ---------------------------------------------------------------------------

export const SCOPE_GROUP_LABELS = {
  account: "Account",
  proofs: "Verification records",
  identity: "Personal information",
} as const;

// ---------------------------------------------------------------------------
// Verification status labels — replace raw tier/level identifiers
// ---------------------------------------------------------------------------

export const VERIFICATION_LEVEL_LABELS: Record<string, string> = {
  none: "Unverified",
  basic: "Basic",
  full: "Verified",
  chip: "Chip Verified",
};

// ---------------------------------------------------------------------------
// Claim / badge display labels — replace internal claim keys with plain text
// ---------------------------------------------------------------------------

export const CLAIM_DISPLAY_LABELS: Record<string, string> = {
  document_verified: "Document Checked",
  liveness_verified: "Selfie Check",
  age_verified: "Age Verified",
  face_match_verified: "Photo Match",
  nationality_verified: "Nationality Verified",
  identity_bound: "Linked to Account",
  sybil_resistant: "Unique Person",
};

// ---------------------------------------------------------------------------
// Capability source labels — replace raw grant source identifiers
// ---------------------------------------------------------------------------

export const GRANT_SOURCE_LABELS: Record<string, string> = {
  requested: "Requested by agent",
  default: "Granted by default",
  session: "Session grant",
  host_policy: "Host policy",
  capability_grant: "Auto-approved",
  boundary: "Pre-authorized",
};

// ---------------------------------------------------------------------------
// ACR display mapping — replace URN fragments with plain labels
// ---------------------------------------------------------------------------

export const ACR_DISPLAY_LABELS: Record<string, string> = {
  tier1: "Account created",
  tier2: "Requires basic verification",
  tier3: "Requires verified identity",
  tier4: "Requires chip-verified identity",
};

const ACR_PREFIX = "urn:zentity:assurance:";

export function formatAcrValue(acr: string): string {
  const fragment = acr.startsWith(ACR_PREFIX)
    ? acr.slice(ACR_PREFIX.length)
    : acr;
  return ACR_DISPLAY_LABELS[fragment] ?? `Assurance: ${fragment}`;
}

// ---------------------------------------------------------------------------
// Error message templates — replace internal error messages with actionable text
// ---------------------------------------------------------------------------

export const ERROR_MESSAGES = {
  prfNotAvailable:
    "This passkey doesn't support the encryption features needed. Please try a different passkey or use a password instead.",
  prfOutputMissing:
    "Your passkey didn't return the expected data. Please try again or use a different sign-in method.",
  walletNotDeterministic:
    "This wallet produced inconsistent signatures. Please use a different wallet or sign in with a passkey or password.",
  sdkInitFailed:
    "Something went wrong loading the verification app. Please refresh and try again.",
  noEnrollmentMethod:
    "No sign-in method available for setup. Please set up a passkey, password, or wallet first.",
  documentCommitmentFailed:
    "We couldn't prepare your document data for verification. Please retry the document step.",
  signedClaimsFailed:
    "We couldn't prepare your verification data. Please retry verification.",
  fheReEnrollment:
    "Your encryption keys or profile data may need to be set up again.",
  recoveryChallengeMissing:
    "Something went wrong with your recovery session. Please start again.",
} as const;
