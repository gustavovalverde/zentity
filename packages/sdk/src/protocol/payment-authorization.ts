/**
 * `payment_authorization` Rich Authorization Request (RFC 9396) type.
 *
 * The OAuth `at+jwt` issued for a CIBA-approved spend carries exactly one
 * `payment_authorization` entry inside `authorization_details`. The entry
 * IS the bounded spend grant: scope strings never carry amount, recipient,
 * or expiry semantics. Per Proposal-0003 D-1 in
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

import { INTENT_HASH_WIRE_PREFIX } from "./intent-hash";

export const PAYMENT_AUTHORIZATION_TYPE = "payment_authorization" as const;

export const PAYMENT_AUTHORIZATION_CAPABILITY =
	"payment_authorization:sign" as const;

const caip2NamespaceRegex = /^[-a-z0-9]{3,8}$/;
const caip2ReferenceRegex = /^[-a-zA-Z0-9]{1,32}$/;
const caip10AccountRegex =
	/^[-a-z0-9]{3,8}:[-a-zA-Z0-9]{1,32}:[a-zA-Z0-9]{1,512}$/;
const decimalStringRegex = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const intentHashPayloadRegex = /^[A-Za-z0-9_-]{43}$/;

export const ChainIdSchema = z.object({
	namespace: z
		.string()
		.regex(caip2NamespaceRegex, "chain.namespace must be CAIP-2 (a-z0-9-)"),
	reference: z
		.string()
		.regex(caip2ReferenceRegex, "chain.reference must be CAIP-2 (a-zA-Z0-9-)"),
});
export type ChainId = z.infer<typeof ChainIdSchema>;

export const AmountUnitSchema = z.enum(["base", "display"]);

export const AmountSchema = z.object({
	currency: z.string().min(1).max(16),
	value: z
		.string()
		.regex(decimalStringRegex, "amount.value must be a decimal string"),
	unit: AmountUnitSchema,
});
export type Amount = z.infer<typeof AmountSchema>;

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

export const IntentHashStringSchema = z
	.string()
	.startsWith(INTENT_HASH_WIRE_PREFIX, "intent_hash must use v1:sha256: prefix")
	.refine(
		(s) => intentHashPayloadRegex.test(s.slice(INTENT_HASH_WIRE_PREFIX.length)),
		"intent_hash payload must be 32 bytes base64url-no-pad",
	);
export type IntentHashString = z.infer<typeof IntentHashStringSchema>;

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

export const PaymentAuthorizationDetailsSchema = z
	.array(PaymentAuthorizationSchema)
	.min(
		1,
		"authorization_details must contain exactly one payment_authorization entry in v1",
	)
	.max(
		1,
		"rar_too_many_entries: v1 supports exactly one payment_authorization entry",
	);
export type PaymentAuthorizationDetails = z.infer<
	typeof PaymentAuthorizationDetailsSchema
>;

export function parsePaymentAuthorization(
	authorizationDetails: unknown,
): PaymentAuthorization {
	const parsed = PaymentAuthorizationDetailsSchema.parse(authorizationDetails);
	const entry = parsed[0];
	if (!entry) {
		throw new Error(
			"parsePaymentAuthorization: schema returned an empty array; min(1) invariant broken",
		);
	}
	return entry;
}

/**
 * CAIP-2 chain reference values used by Zcash. The wire form embeds these
 * in `chain.reference` and as the middle segment of every CAIP-10
 * recipient.
 */
export type ChainReference = "main" | "test" | "regtest";

const NETWORK_TO_CAIP_REFERENCE: Record<string, ChainReference> = {
	mainnet: "main",
	testnet: "test",
	regtest: "regtest",
};

export function networkToChainReference(network: string): ChainReference {
	const reference = NETWORK_TO_CAIP_REFERENCE[network];
	if (!reference) {
		throw new Error(`unsupported payment network: ${network}`);
	}
	return reference;
}

const ZIP_321_PREFIX = "zcash:";

/**
 * Parses the ZIP-321 `payment_uri` returned by zpay (`zcash:utest1...?...`)
 * into the CAIP-10 account id the canonical RAR carries.
 */
export function paymentUriToCaip10(
	paymentUri: string,
	chainReference: ChainReference,
): string {
	if (!paymentUri.startsWith(ZIP_321_PREFIX)) {
		throw new Error(`payment_uri must start with "${ZIP_321_PREFIX}"`);
	}
	const afterScheme = paymentUri.slice(ZIP_321_PREFIX.length);
	const queryStart = afterScheme.indexOf("?");
	const address =
		queryStart === -1 ? afterScheme : afterScheme.slice(0, queryStart);
	if (!address) {
		throw new Error("payment_uri missing recipient address");
	}
	return `zcash:${chainReference}:${address}`;
}
