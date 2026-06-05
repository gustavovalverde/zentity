/**
 * `payment_authorization` Rich Authorization Request (RFC 9396) type.
 *
 * The OAuth `at+jwt` issued for a CIBA-approved spend carries exactly one
 * `payment_authorization` entry inside `authorization_details`. The entry IS
 * the bounded spend grant: scope strings never carry amount, recipient, or
 * expiry semantics. Per Proposal-0003 D-1 in
 * `/Users/gustavovalverde/dev/zfnd/zpay/docs/proposals/0003-agent-wallet-production-architecture.md`.
 *
 * # Field-level decisions
 *
 * - `chain`: CAIP-2 namespace + reference. Replaces freeform `network` strings.
 * - `recipient`: CAIP-10 account id. Replaces chain-specific address strings.
 * - `amount`: `{ currency, value, unit }` with decimal-string `value`. Defeats
 *   IEEE-754 drift across JSON parsers (D-10).
 * - `intent_hash`: parsed-tuple binding `"v1:sha256:<base64url-no-pad>"`. The
 *   wallet recomputes this on every spend (Proposal-0003 D-4); see
 *   `./intent-hash.ts` for the canonical hasher with the locked
 *   conformance vector.
 * - `expires_at`: chain-tagged `{ kind, value }`. Block-height for Zcash;
 *   slot/timestamp/block-number for future chains.
 *
 * # v1 contract
 *
 * - Exactly one `payment_authorization` entry per `authorization_details`.
 *   Batch flows reject with `rar_too_many_entries` (D-14).
 * - The capability id is `payment_authorization:sign` (D-15, D-1).
 */

import { z } from "zod";

/**
 * The RAR `type` discriminator. Wire-stable; do NOT rename without bumping a
 * versioned migration on every consumer (the issuer, the wallet, and every
 * integrator who copied this).
 */
export const PAYMENT_AUTHORIZATION_TYPE = "payment_authorization" as const;

/** The capability id that grants minting `payment_authorization` tokens. */
export const PAYMENT_AUTHORIZATION_CAPABILITY =
  "payment_authorization:sign" as const;

/** Wire-tag for the only signed-payload format supported in v1. */
export const SIGNED_PAYLOAD_FORMAT_PCZT_V1 = "pczt-v1" as const;

/** Wire prefix of the parsed-tuple intent hash. */
export const INTENT_HASH_WIRE_PREFIX = "v1:sha256:" as const;

// CAIP-2 namespace: lowercase ascii + digits + dashes, 3-8 chars.
const caip2NamespaceRegex = /^[-a-z0-9]{3,8}$/;
// CAIP-2 reference: alphanumeric + dashes, 1-32 chars.
const caip2ReferenceRegex = /^[-a-zA-Z0-9]{1,32}$/;
// CAIP-10 account id: `{namespace}:{reference}:{address}`; address up to 128 ASCII chars.
const caip10AccountRegex =
  /^[-a-z0-9]{3,8}:[-a-zA-Z0-9]{1,32}:[a-zA-Z0-9]{1,128}$/;
// Decimal-string amount: optional leading zero, no separators, no sign.
const decimalStringRegex = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
// Intent hash payload after the version prefix: 43 base64url-no-pad chars (32 bytes).
const intentHashPayloadRegex = /^[A-Za-z0-9_-]{43}$/;

/** CAIP-2 chain identifier (`{ namespace, reference }`). */
export const ChainIdSchema = z.object({
  namespace: z
    .string()
    .regex(caip2NamespaceRegex, "chain.namespace must be CAIP-2 (a-z0-9-)"),
  reference: z
    .string()
    .regex(caip2ReferenceRegex, "chain.reference must be CAIP-2 (a-zA-Z0-9-)"),
});
export type ChainId = z.infer<typeof ChainIdSchema>;

/** Unit interpretation of `amount.value`. */
export const AmountUnitSchema = z.enum(["base", "display"]);
export type AmountUnit = z.infer<typeof AmountUnitSchema>;

/** Chain-neutral amount (D-10). */
export const AmountSchema = z.object({
  currency: z.string().min(1).max(16),
  value: z
    .string()
    .regex(decimalStringRegex, "amount.value must be a decimal string"),
  unit: AmountUnitSchema,
});
export type Amount = z.infer<typeof AmountSchema>;

/** Chain-tagged expiry (D-3). */
export const ExpiresAtSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("block_height"),
    value: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("slot"), value: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("block_number"),
    value: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("timestamp_seconds"),
    value: z.number().int().nonnegative(),
  }),
]);
export type ExpiresAt = z.infer<typeof ExpiresAtSchema>;

/**
 * Versioned intent-hash wire string: `"v1:sha256:<base64url-no-pad 32 bytes>"`.
 * Future hash schemes co-exist as additional `v{N}:` prefixes.
 */
export const IntentHashStringSchema = z
  .string()
  .startsWith(INTENT_HASH_WIRE_PREFIX, "intent_hash must use v1:sha256: prefix")
  .refine(
    (s) => intentHashPayloadRegex.test(s.slice(INTENT_HASH_WIRE_PREFIX.length)),
    "intent_hash payload must be 32 bytes base64url-no-pad"
  );
export type IntentHashString = z.infer<typeof IntentHashStringSchema>;

/**
 * The full `payment_authorization` RAR entry as it appears in
 * `authorization_details[]`.
 */
export const PaymentAuthorizationSchema = z.object({
  type: z.literal(PAYMENT_AUTHORIZATION_TYPE),
  chain: ChainIdSchema,
  recipient: z
    .string()
    .regex(caip10AccountRegex, "recipient must be CAIP-10 account id"),
  amount: AmountSchema,
  payment_id: z.string().min(1).max(128),
  intent_hash: IntentHashStringSchema,
  expires_at: ExpiresAtSchema,
});
export type PaymentAuthorization = z.infer<typeof PaymentAuthorizationSchema>;

/**
 * `authorization_details` v1 contract: exactly one `payment_authorization`
 * entry per token. Returns a typed error when the count differs.
 */
export const PaymentAuthorizationDetailsSchema = z
  .array(PaymentAuthorizationSchema)
  .min(
    1,
    "authorization_details must contain exactly one payment_authorization entry in v1"
  )
  .max(
    1,
    "rar_too_many_entries: v1 supports exactly one payment_authorization entry"
  );
export type PaymentAuthorizationDetails = z.infer<
  typeof PaymentAuthorizationDetailsSchema
>;

/**
 * Type-guard helper. Returns the single parsed entry if the input is a
 * valid v1 `authorization_details` array.
 */
export function parsePaymentAuthorization(
  authorizationDetails: unknown
): PaymentAuthorization {
  const parsed = PaymentAuthorizationDetailsSchema.parse(authorizationDetails);
  const entry = parsed[0];
  if (!entry) {
    // PaymentAuthorizationDetailsSchema enforces .min(1); reaching here means
    // the schema invariant changed without updating this caller.
    throw new Error(
      "parsePaymentAuthorization: schema returned an empty array; min(1) invariant broken"
    );
  }
  return entry;
}
