import type { IdentityFields } from "./disclosure-registry";

import { z } from "zod";

const IdentityAddressSchema = z
  .object({
    formatted: z.string().optional(),
    street_address: z.string().optional(),
    locality: z.string().optional(),
    region: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
  })
  .strict();

export const IdentityFieldsSchema = z
  .object({
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    name: z.string().optional(),
    birthdate: z.string().optional(),
    address: IdentityAddressSchema.optional(),
    document_number: z.string().optional(),
    document_type: z.string().optional(),
    issuing_country: z.string().optional(),
    nationality: z.string().optional(),
    nationalities: z.array(z.string()).optional(),
  })
  .strict();

export function normalizeIdentityFields(
  identity: Partial<IdentityFields>
): Partial<IdentityFields> {
  const normalized: Partial<IdentityFields> = {};

  const setIfNonEmpty = (key: keyof IdentityFields, value?: string) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        normalized[key] = trimmed as never;
      }
    }
  };

  setIfNonEmpty("given_name", identity.given_name);
  setIfNonEmpty("family_name", identity.family_name);
  setIfNonEmpty("name", identity.name);
  setIfNonEmpty("birthdate", identity.birthdate);
  setIfNonEmpty("document_number", identity.document_number);
  setIfNonEmpty("document_type", identity.document_type);
  setIfNonEmpty("issuing_country", identity.issuing_country);
  setIfNonEmpty("nationality", identity.nationality);

  if (Array.isArray(identity.nationalities)) {
    const filtered = identity.nationalities
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (filtered.length > 0) {
      normalized.nationalities = filtered;
    }
  }

  if (identity.address) {
    const address = {
      formatted: identity.address.formatted?.trim(),
      street_address: identity.address.street_address?.trim(),
      locality: identity.address.locality?.trim(),
      region: identity.address.region?.trim(),
      postal_code: identity.address.postal_code?.trim(),
      country: identity.address.country?.trim(),
    };
    const entries = Object.entries(address).filter(
      ([, value]) => typeof value === "string" && value.length > 0
    );
    if (entries.length > 0) {
      normalized.address = Object.fromEntries(entries);
    }
  }

  return normalized;
}
