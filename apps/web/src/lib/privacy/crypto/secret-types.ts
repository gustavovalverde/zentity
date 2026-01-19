/**
 * Secret Types - Single Source of Truth
 *
 * This file defines all valid secret types used in the encrypted secrets system.
 * Import these constants instead of using string literals to prevent typos and
 * enable compile-time type checking.
 *
 * @example
 * // CORRECT - use the constant
 * import { SECRET_TYPES } from "@/lib/privacy/crypto/secret-types";
 * const bundle = await trpc.secrets.getSecretBundle.query({
 *   secretType: SECRET_TYPES.FHE_KEYS,
 * });
 *
 * // WRONG - don't use string literals
 * const bundle = await trpc.secrets.getSecretBundle.query({
 *   secretType: "fhe-keys", // Typo! Should be "fhe_keys"
 * });
 */

import { z } from "zod";

/**
 * All valid secret types in the system.
 * Add new types here when introducing new encrypted secret categories.
 */
export const SECRET_TYPES = {
  /** FHE (Fully Homomorphic Encryption) key material */
  FHE_KEYS: "fhe_keys",
  /** User profile data (encrypted PII) - versioned for migration support */
  PROFILE: "profile_v1",
} as const;

/**
 * Zod schema for validating secret types.
 * Use this in tRPC routers and API validation.
 */
export const secretTypeSchema = z.enum([
  SECRET_TYPES.FHE_KEYS,
  SECRET_TYPES.PROFILE,
]);

/**
 * TypeScript type for secret types.
 * Derived from the schema for type safety.
 */
export type SecretType = z.infer<typeof secretTypeSchema>;
