import { z } from "zod";

export const PROFILE_FIELDS = [
  "name",
  "address",
  "birthdate",
  "email",
] as const;

export const profileFieldSchema = z.enum(PROFILE_FIELDS);

export type PublicProfileField = (typeof PROFILE_FIELDS)[number];

const PROFILE_FIELD_ORDER: Record<PublicProfileField, number> = {
  name: 0,
  address: 1,
  birthdate: 2,
  email: 3,
};

const PROFILE_FIELD_SCOPE_MAP: Partial<Record<PublicProfileField, string>> = {
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
    (field): field is PublicProfileField => PROFILE_FIELD_SCOPE_MAP[field] != null
  );
}

export function buildIdentityScopeString(
  fields: readonly PublicProfileField[]
): string {
  const scopes = new Set<string>(["openid"]);
  for (const field of fields) {
    const scope = PROFILE_FIELD_SCOPE_MAP[field];
    if (scope) {
      scopes.add(scope);
    }
  }
  return Array.from(scopes).join(" ");
}

export function buildProfileFieldKey(
  fields: readonly PublicProfileField[]
): string {
  return normalizeProfileFields(fields).join(",");
}
