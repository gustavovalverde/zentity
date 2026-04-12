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

import { base64ToBytes } from "@/lib/privacy/primitives/base64";

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

const wrappedDekJsonSchema = z.object({
  alg: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

export const wrappedDekSchema = z
  .string()
  .min(1)
  .refine(
    (val) => {
      try {
        return wrappedDekJsonSchema.safeParse(JSON.parse(val)).success;
      } catch {
        return false;
      }
    },
    {
      message:
        "wrappedDek must be a JSON object with {alg, iv, ciphertext} as non-empty strings",
    }
  );

export const prfSaltSchema = z
  .string()
  .min(1)
  .refine(
    (val) => {
      try {
        return base64ToBytes(val).byteLength === 32;
      } catch {
        return false;
      }
    },
    { message: "prfSalt must be base64-encoded 32 bytes" }
  );

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
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
  userId: string;
}

/**
 * Enrollment context for OPAQUE password credentials.
 */
export interface OpaqueEnrollmentContext {
  exportKey: Uint8Array;
  userId: string;
}

/**
 * Enrollment context for wallet (EIP-712) credentials.
 */
export interface WalletEnrollmentContext {
  address: string;
  chainId: number;
  expiresAt: number;
  signatureBytes: Uint8Array;
  signedAt: number;
  userId: string;
}

/**
 * Union type for credential enrollment context.
 */
export type EnrollmentCredential =
  | { type: "passkey"; context: PasskeyEnrollmentContext }
  | { type: "opaque"; context: OpaqueEnrollmentContext }
  | { type: "wallet"; context: WalletEnrollmentContext };
