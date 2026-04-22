/**
 * MCP profile field adapter.
 *
 * Maps MCP tool field names to the Zentity OIDC Disclosure Profile scopes.
 * The source of truth for scope → claim mapping is the disclosure registry
 * at `apps/web/src/lib/auth/oidc/disclosure/registry.ts`.
 *
 * Exposed fields: name, address, birthdate.
 * Intentionally excluded: identity.document, identity.nationality — these
 * contain sensitive document details not suitable for agent-initiated access.
 */

import { z } from "zod";

export const PROFILE_FIELDS = ["name", "address", "birthdate"] as const;

export const profileFieldSchema = z.enum(PROFILE_FIELDS);

export type PublicProfileField = (typeof PROFILE_FIELDS)[number];

const PROFILE_FIELD_ORDER: Record<PublicProfileField, number> = {
  name: 0,
  address: 1,
  birthdate: 2,
};

/**
 * Field → disclosure scope mapping.
 * Every field requires an identity.* scope (vault-gated, userinfo-only,
 * exact-bound per the disclosure profile).
 */
const PROFILE_FIELD_SCOPE_MAP: Record<PublicProfileField, string> = {
  name: "identity.name",
  address: "identity.address",
  birthdate: "identity.dob",
};

export function normalizeProfileFields(
  fields: readonly PublicProfileField[]
): PublicProfileField[] {
  return Array.from(new Set(fields)).sort(
    (left, right) => PROFILE_FIELD_ORDER[left] - PROFILE_FIELD_ORDER[right]
  ) as PublicProfileField[];
}

export function getProtectedProfileFields(
  fields: readonly PublicProfileField[]
): PublicProfileField[] {
  return fields.filter(
    (field): field is PublicProfileField => field in PROFILE_FIELD_SCOPE_MAP
  );
}

export function buildIdentityScopeString(
  fields: readonly PublicProfileField[]
): string {
  const scopes = new Set<string>(["openid"]);
  for (const field of fields) {
    scopes.add(PROFILE_FIELD_SCOPE_MAP[field]);
  }
  return Array.from(scopes).join(" ");
}

export function buildProfileFieldKey(
  fields: readonly PublicProfileField[]
): string {
  return normalizeProfileFields(fields).join(",");
}
