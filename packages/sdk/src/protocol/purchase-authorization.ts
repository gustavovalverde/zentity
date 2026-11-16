/**
 * The `purchase` and `x402_purchase` Rich Authorization Request (RFC 9396)
 * types, and the identity-strength vocabulary an x402 merchant states.
 *
 * - `purchase`: an agent asks the user to approve buying an item from a
 *   named merchant. The amount is the agent's statement; Zentity releases the
 *   user's shipping details once, and no money moves through Zentity.
 * - `x402_purchase`: an agent asks the user to prove to one x402 merchant that
 *   their identity is verified. `payment_requirements` copies the merchant's
 *   requirement verbatim, so the merchant can check that what the user saw is
 *   what the agent pays. Zentity does not sign or limit that payment.
 *
 * Every object is strict: RFC 9396 §5 refuses a known type with unknown,
 * missing, or invalid members. Text members refuse control and format
 * characters, the rule the CIBA plugin applies to `binding_message`. No
 * schema transforms, defaults, or coerces, so the parsed entry is the entry
 * that was sent.
 */

import { z } from "zod";

export const PURCHASE_TYPE = "purchase" as const;
export const X402_PURCHASE_TYPE = "x402_purchase" as const;

// ─── Identity strength ──────────────────────────────────────────────

/**
 * The identity-evidence strengths a merchant may require, weakest first.
 * The names are the wire vocabulary; no numeric level is ever sent.
 */
export const IDENTITY_STRENGTHS = [
	"documentary",
	"documentary_full",
	"cryptographic_chip",
] as const;

export type IdentityStrength = (typeof IDENTITY_STRENGTHS)[number];

export const IdentityStrengthSchema = z.enum(IDENTITY_STRENGTHS);

/**
 * Whether `actual` is at least `required`. A user without identity evidence
 * (`"none"`, or any value outside the vocabulary) meets no requirement.
 */
export function meetsIdentityStrength(
	actual: string,
	required: IdentityStrength,
): boolean {
	const actualRank = IDENTITY_STRENGTHS.indexOf(actual as IdentityStrength);
	return (
		actualRank !== -1 && actualRank >= IDENTITY_STRENGTHS.indexOf(required)
	);
}

// ─── Shared member rules ────────────────────────────────────────────

const NON_PLAIN_TEXT = /[\p{Cc}\p{Cf}]/u;

function plainText(min: number, max: number) {
	return z
		.string()
		.min(min)
		.max(max)
		.refine((value) => !NON_PLAIN_TEXT.test(value), "must be plain text");
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a resource URL is `https:`, or `http:` on a loopback host. The
 * server refuses the loopback form in production.
 */
export function isAllowedResourceUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password || url.hash) {
		return false;
	}
	return (
		url.protocol === "https:" ||
		(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
	);
}

/** Whether a URL is `http:` on a loopback host. */
export function isLoopbackHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

// ─── purchase ───────────────────────────────────────────────────────

export const PurchaseAuthorizationSchema = z
	.object({
		type: z.literal(PURCHASE_TYPE),
		merchant: z.object({ name: plainText(1, 64) }).strict(),
		item: plainText(1, 120),
		amount: z
			.object({
				value: z
					.string()
					.regex(
						/^\d{1,12}(\.\d{1,4})?$/,
						"amount.value must be a decimal string",
					),
				currency: z
					.string()
					.regex(/^[A-Z]{3}$/, "amount.currency must be an ISO 4217 code"),
			})
			.strict(),
	})
	.strict();
export type PurchaseAuthorization = z.infer<typeof PurchaseAuthorizationSchema>;

// ─── x402_purchase ──────────────────────────────────────────────────

const caip2NetworkRegex = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const onChainIdRegex = /^[-_.:a-zA-Z0-9]{1,128}$/;

/**
 * One x402 v2 `exact` payment requirement, as the merchant advertised it.
 * x402 v2 §6.1 reserves `extra.assetTransferMethod` and `extra.paymentFlow`;
 * only the `authorization` flow is accepted, because the merchant verifies
 * the payment before it settles (verify, then record the approval, then
 * settle).
 */
export const X402PaymentRequirementsSchema = z
	.object({
		scheme: z.literal("exact"),
		network: z
			.string()
			.regex(caip2NetworkRegex, "network must be a CAIP-2 chain id"),
		amount: z
			.string()
			.regex(/^[1-9][0-9]{0,77}$/, "amount must be a positive atomic amount"),
		asset: z.string().regex(onChainIdRegex, "asset must be an on-chain id"),
		payTo: z.string().regex(onChainIdRegex, "payTo must be an on-chain id"),
		maxTimeoutSeconds: z.number().int().min(1).max(3600),
		extra: z
			.object({
				name: plainText(1, 64).optional(),
				version: plainText(1, 32).optional(),
				assetTransferMethod: z
					.enum(["eip3009", "permit2", "erc7710"])
					.optional(),
				paymentFlow: z.literal("authorization").optional(),
			})
			.strict()
			.optional(),
	})
	.strict();
export type X402PaymentRequirements = z.infer<
	typeof X402PaymentRequirementsSchema
>;

export const X402PurchaseAuthorizationSchema = z
	.object({
		type: z.literal(X402_PURCHASE_TYPE),
		resource_url: plainText(1, 2048).refine(
			isAllowedResourceUrl,
			"resource_url must be https, or http on a loopback host",
		),
		resource_description: plainText(1, 256).optional(),
		payment_requirements: X402PaymentRequirementsSchema,
		min_identity_strength: IdentityStrengthSchema,
	})
	.strict();
export type X402PurchaseAuthorization = z.infer<
	typeof X402PurchaseAuthorizationSchema
>;
