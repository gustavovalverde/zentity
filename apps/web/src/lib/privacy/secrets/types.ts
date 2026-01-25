/**
 * Secret Types - Single Source of Truth
 *
 * This file defines all valid secret types used in the encrypted secrets system.
 * Import these constants instead of using string literals to prevent typos and
 * enable compile-time type checking.
 *
 * @example
 * import { SECRET_TYPES } from "@/lib/privacy/secrets/types";
 * const bundle = await trpc.secrets.getSecretBundle.query({
 *   secretType: SECRET_TYPES.FHE_KEYS,
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
  /** User profile data (encrypted PII) */
  PROFILE: "profile",
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

/**
 * Envelope format for encrypted payloads.
 * - "json": Human-readable, slightly larger
 * - "msgpack": Binary, more compact
 */
export type EnvelopeFormat = "json" | "msgpack";

/**
 * Enrollment context for passkey credentials.
 */
export interface PasskeyEnrollmentContext {
  credentialId: string;
  userId: string;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}

/**
 * Enrollment context for OPAQUE password credentials.
 */
export interface OpaqueEnrollmentContext {
  userId: string;
  exportKey: Uint8Array;
}

/**
 * Enrollment context for wallet (EIP-712) credentials.
 */
export interface WalletEnrollmentContext {
  userId: string;
  address: string;
  chainId: number;
  signatureBytes: Uint8Array;
  signedAt: number;
  expiresAt: number;
}

/**
 * Union type for credential enrollment context.
 */
export type EnrollmentCredential =
  | { type: "passkey"; context: PasskeyEnrollmentContext }
  | { type: "opaque"; context: OpaqueEnrollmentContext }
  | { type: "wallet"; context: WalletEnrollmentContext };
