/**
 * Zentity OIDC Disclosure Registry
 *
 * Single source of truth for the Zentity disclosure profile.
 * Every scope, claim mapping, delivery rule, and privacy requirement
 * is defined here.
 *
 * Cross-channel enforcement:
 * - Web auth and CIBA import directly from this module.
 * - MCP and demo-rp are separate workspaces; their scope configs
 *   are validated against this registry by rp-contract.test.ts.
 *
 * See docs/(protocols)/disclosure-profile.md for the written spec.
 */

type ScopeFamily = "standard" | "proof" | "identity" | "operational";
type DeliverySurface = "id_token" | "userinfo" | "access_token";

interface ScopeEntry {
  readonly claims: readonly string[];
  readonly delivery: readonly DeliverySurface[];
  readonly description: string;
  readonly exactBindingRequired: boolean;
  readonly expandsTo?: readonly string[];
  readonly family: ScopeFamily;
  readonly scope: string;
  readonly vaultRequired: boolean;
}

// ---------------------------------------------------------------------------
// Entry definitions — `as const satisfies` preserves literal types while
// validating against the ScopeEntry shape. Types are derived from data,
// never re-declared manually.
// ---------------------------------------------------------------------------

const STANDARD_ENTRIES = [
  {
    scope: "openid",
    family: "standard",
    claims: ["sub"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "OpenID Connect authentication",
  },
  {
    scope: "email",
    family: "standard",
    claims: ["email", "email_verified"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Email address",
  },
  {
    scope: "offline_access",
    family: "standard",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Access when you're not using the app",
  },
] as const satisfies readonly ScopeEntry[];

const PROOF_ENTRIES = [
  {
    scope: "proof:verification",
    family: "proof",
    claims: [
      "verification_level",
      "verified",
      "identity_bound",
      "sybil_resistant",
    ],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Identity verification status",
  },
  {
    scope: "proof:age",
    family: "proof",
    claims: ["age_verification"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Proof you meet the age requirement",
  },
  {
    scope: "proof:document",
    family: "proof",
    claims: ["document_verified"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Document verification status",
  },
  {
    scope: "proof:liveness",
    family: "proof",
    claims: ["liveness_verified", "face_match_verified"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Liveness and photo match results",
  },
  {
    scope: "proof:nationality",
    family: "proof",
    claims: ["nationality_verified", "nationality_group"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Nationality verification",
  },
  {
    scope: "proof:compliance",
    family: "proof",
    claims: ["policy_version", "verification_time", "attestation_expires_at"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Verification policy and timestamps",
  },
  {
    scope: "proof:chip",
    family: "proof",
    claims: ["chip_verified", "chip_verification_method"],
    delivery: ["id_token", "userinfo"],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Passport NFC chip verification status",
  },
] as const satisfies readonly ScopeEntry[];

/**
 * proof:sybil is NOT in PROOF_ENTRIES because it has fundamentally different
 * semantics: access_token-only delivery, per-RP pseudonym (not a verification
 * status boolean), and must not inherit the generic my_proofs CIBA auto-approval
 * path via deriveCapabilityName/extractProofScopes.
 */
const SYBIL_ENTRY = {
  scope: "proof:sybil",
  family: "proof",
  claims: ["sybil_nullifier"],
  delivery: ["access_token"],
  vaultRequired: false,
  exactBindingRequired: false,
  description: "Per-RP pseudonymous sybil nullifier",
} as const satisfies ScopeEntry;

const PROOF_UMBRELLA = {
  scope: "proof:identity",
  family: "proof",
  claims: [],
  delivery: ["id_token", "userinfo"],
  vaultRequired: false,
  exactBindingRequired: false,
  description: "All identity verification proofs",
  expandsTo: PROOF_ENTRIES.map((e) => e.scope),
} as const satisfies ScopeEntry;

/**
 * Identity fields that can be shared via OAuth.
 * Matches OIDC standard claims + Zentity-specific fields.
 */
export interface IdentityFields {
  address?: {
    formatted?: string;
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  birthdate?: string;
  document_number?: string;
  document_type?: string;
  family_name?: string;
  given_name?: string;
  issuing_country?: string;
  name?: string;
  nationalities?: string[];
  nationality?: string;
}

const IDENTITY_ENTRIES = [
  {
    scope: "identity.name",
    family: "identity",
    claims: ["given_name", "family_name", "name"],
    delivery: ["userinfo"],
    vaultRequired: true,
    exactBindingRequired: true,
    description: "Full legal name",
  },
  {
    scope: "identity.dob",
    family: "identity",
    claims: ["birthdate"],
    delivery: ["userinfo"],
    vaultRequired: true,
    exactBindingRequired: true,
    description: "Date of birth",
  },
  {
    scope: "identity.address",
    family: "identity",
    claims: ["address"],
    delivery: ["userinfo"],
    vaultRequired: true,
    exactBindingRequired: true,
    description: "Residential address",
  },
  {
    scope: "identity.document",
    family: "identity",
    claims: ["document_number", "document_type", "issuing_country"],
    delivery: ["userinfo"],
    vaultRequired: true,
    exactBindingRequired: true,
    description: "Document details (number, type, country)",
  },
  {
    scope: "identity.nationality",
    family: "identity",
    claims: ["nationality", "nationalities"],
    delivery: ["userinfo"],
    vaultRequired: true,
    exactBindingRequired: true,
    description: "Nationality",
  },
] as const satisfies readonly ScopeEntry[];

const OPERATIONAL_ENTRIES = [
  {
    scope: "agent:host.register",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Register an agent host",
  },
  {
    scope: "agent:session.register",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Register an agent session",
  },
  {
    scope: "agent:session.revoke",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Revoke an agent session",
  },
  {
    scope: "agent:introspect",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Introspect agent state",
  },
  {
    scope: "compliance:key:read",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Read compliance encryption key",
  },
  {
    scope: "compliance:key:write",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "Manage compliance encryption key",
  },
  {
    scope: "identity_verification",
    family: "operational",
    claims: [],
    delivery: [],
    vaultRequired: false,
    exactBindingRequired: false,
    description: "OID4VCI credential issuance",
  },
] as const satisfies readonly ScopeEntry[];

// ---------------------------------------------------------------------------
// Registry index and derived types
// ---------------------------------------------------------------------------

const ALL_ENTRIES: readonly ScopeEntry[] = [
  ...STANDARD_ENTRIES,
  PROOF_UMBRELLA,
  ...PROOF_ENTRIES,
  SYBIL_ENTRY,
  ...IDENTITY_ENTRIES,
  ...OPERATIONAL_ENTRIES,
];

const REGISTRY_INDEX = new Map<string, ScopeEntry>(
  ALL_ENTRIES.map((e) => [e.scope, e])
);

/** Derived types — no manual duplication. */
export type ProofScope = (typeof PROOF_ENTRIES)[number]["scope"];
export type IdentityScope = (typeof IDENTITY_ENTRIES)[number]["scope"];
type ProofClaimKey = (typeof PROOF_ENTRIES)[number]["claims"][number];

/** Derived scope arrays — no manual re-declaration. */
export const PROOF_SCOPES: readonly ProofScope[] = PROOF_ENTRIES.map(
  (e) => e.scope
);
export const IDENTITY_SCOPES: readonly IdentityScope[] = IDENTITY_ENTRIES.map(
  (e) => e.scope
);

// ---------------------------------------------------------------------------
// Flat scope lists
// ---------------------------------------------------------------------------

export const OAUTH_SCOPES = ALL_ENTRIES.map(
  (e) => e.scope
) as readonly string[];
export const OAUTH_SCOPE_SET = new Set<string>(OAUTH_SCOPES);
export const HIDDEN_SCOPES = new Set(["openid", "profile"]);

// ---------------------------------------------------------------------------
// Scope-to-claim mappings (derived from entries)
// ---------------------------------------------------------------------------

const PROOF_SCOPE_CLAIMS = Object.fromEntries(
  PROOF_ENTRIES.map((e) => [e.scope, e.claims])
) as unknown as Record<ProofScope, readonly ProofClaimKey[]>;

export const IDENTITY_SCOPE_CLAIMS = Object.fromEntries(
  IDENTITY_ENTRIES.map((e) => [e.scope, e.claims])
) as unknown as Record<IdentityScope, readonly string[]>;

// ---------------------------------------------------------------------------
// Delivery surface index — maps claim key → allowed surfaces.
// This is how the registry enforces delivery rules, not just records them.
// ---------------------------------------------------------------------------

const CLAIM_SURFACES = new Map<string, Set<DeliverySurface>>();
for (const entry of [...PROOF_ENTRIES, ...IDENTITY_ENTRIES]) {
  for (const claim of entry.claims) {
    const existing = CLAIM_SURFACES.get(claim);
    if (existing) {
      for (const surface of entry.delivery) {
        existing.add(surface);
      }
    } else {
      CLAIM_SURFACES.set(claim, new Set(entry.delivery));
    }
  }
}

// ---------------------------------------------------------------------------
// Descriptions (derived from entries)
// ---------------------------------------------------------------------------

export const SCOPE_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  ALL_ENTRIES.map((e) => [e.scope, e.description])
);

export const PROOF_SCOPE_DESCRIPTIONS: Record<ProofScope, string> =
  Object.fromEntries(
    PROOF_ENTRIES.map((e) => [e.scope, e.description])
  ) as Record<ProofScope, string>;

export const IDENTITY_SCOPE_DESCRIPTIONS: Record<IdentityScope, string> =
  Object.fromEntries(
    IDENTITY_ENTRIES.map((e) => [e.scope, e.description])
  ) as Record<IdentityScope, string>;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for standard proof scopes (verification status booleans).
 * Excludes proof:identity (umbrella) and proof:sybil (access_token-only
 * pseudonym that must not inherit the generic CIBA auto-approval path).
 */
export function isProofScope(scope: string): scope is ProofScope {
  return (PROOF_SCOPES as readonly string[]).includes(scope);
}

export function isIdentityScope(scope: string): scope is IdentityScope {
  return REGISTRY_INDEX.get(scope)?.family === "identity";
}

export function extractProofScopes(scopes: readonly string[]): ProofScope[] {
  return scopes.filter(isProofScope);
}

export function extractIdentityScopes(
  scopes: readonly string[]
): IdentityScope[] {
  return scopes.filter(isIdentityScope);
}

export function hasAnyProofScope(scopes: readonly string[]): boolean {
  return scopes.some((s) => s === "proof:identity" || isProofScope(s));
}

// ---------------------------------------------------------------------------
// Claim filtering — surface-enforced
// ---------------------------------------------------------------------------

/**
 * Get allowed proof claim keys based on scopes.
 * `proof:identity` umbrella expands to all proof claims.
 */
function getProofClaimKeys(scopes: readonly string[]): Set<ProofClaimKey> {
  if (scopes.includes("proof:identity")) {
    return new Set(Object.values(PROOF_SCOPE_CLAIMS).flat());
  }

  const keys = new Set<ProofClaimKey>();
  for (const scope of extractProofScopes(scopes)) {
    for (const key of PROOF_SCOPE_CLAIMS[scope]) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Filter proof claims to only those allowed by scopes AND deliverable
 * on the given surface. This enforces the registry's delivery rules:
 * proof:sybil's `sybil_nullifier` is access_token-only and will be
 * excluded when surface is "id_token" or "userinfo".
 */
export function filterProofClaimsByScopes(
  claims: Record<string, unknown>,
  scopes: readonly string[],
  surface: "id_token" | "userinfo"
): Record<string, unknown> {
  const allowedKeys = getProofClaimKeys(scopes);
  const filtered: Record<string, unknown> = {};

  for (const key of allowedKeys) {
    if (!CLAIM_SURFACES.get(key)?.has(surface)) {
      continue;
    }
    if (key in claims && claims[key] !== undefined) {
      filtered[key] = claims[key];
    }
  }

  return filtered;
}

/**
 * Filter identity fields to only those allowed by consented scopes.
 * Identity claims are always userinfo-only — the delivery surface is
 * not parameterized because no other surface is valid.
 */
export function filterIdentityByScopes(
  identity: IdentityFields,
  scopes: readonly string[]
): Partial<IdentityFields> {
  const allowedKeys = new Set<string>();
  for (const scope of extractIdentityScopes(scopes)) {
    for (const claim of IDENTITY_SCOPE_CLAIMS[scope]) {
      allowedKeys.add(claim);
    }
  }

  const source = identity as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in source && source[key] !== undefined) {
      filtered[key] = source[key];
    }
  }

  return filtered as Partial<IdentityFields>;
}

/**
 * Returns human-readable labels for identity scopes whose claim keys
 * are all absent in the given payload. Used by consent/approval UIs
 * to detect missing profile data before attempting to stage.
 */
export function findMissingIdentityFields(
  payload: Record<string, unknown>,
  scopes: readonly string[]
): string[] {
  const missing: string[] = [];
  for (const scope of extractIdentityScopes(scopes)) {
    const claimKeys = IDENTITY_SCOPE_CLAIMS[scope];
    const hasAny = claimKeys.some(
      (key) => payload[key] !== undefined && payload[key] !== null
    );
    if (!hasAny) {
      missing.push(IDENTITY_SCOPE_DESCRIPTIONS[scope]);
    }
  }
  return missing;
}
