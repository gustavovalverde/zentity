import {
	decodePaymentRequiredHeader,
	decodePaymentResponseHeader,
	decodePaymentSignatureHeader,
	encodePaymentRequiredHeader,
	encodePaymentResponseHeader as encodeX402PaymentResponseHeader,
	encodePaymentSignatureHeader as encodeX402PaymentSignatureHeader,
} from "@x402/core/http";
import type {
	Network,
	PaymentPayload,
	PaymentRequired,
	PaymentRequirements,
	ResourceInfo,
	SettleResponse,
} from "@x402/core/types";
import { z } from "zod";

import {
	IDENTITY_STRENGTHS,
	type IdentityStrength,
	IdentityStrengthSchema,
} from "../protocol/purchase-authorization";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

export type PaymentRequirement = PaymentRequirements & {
	network: Network;
};

export type PaymentRequiredPayload = Omit<
	PaymentRequired,
	"accepts" | "x402Version"
> & {
	accepts: PaymentRequirement[];
	x402Version: 2;
};

export type PaymentSignaturePayload = PaymentPayload & {
	x402Version: 2;
};

export interface CreatePaymentRequiredOptions {
	accepts: PaymentRequirement | PaymentRequirement[];
	description?: string;
	extensions?: Record<string, unknown>;
	mimeType?: string;
	resource: Pick<ResourceInfo, "url">;
	/**
	 * A `WWW-Authenticate` challenge for the 402, such as
	 * {@link PROOF_OF_HUMAN_CHALLENGE} for a resource that needs a
	 * DPoP-presented Proof-of-Human token.
	 */
	wwwAuthenticate?: string;
}

function buildPaymentRequiredPayload(
	options: CreatePaymentRequiredOptions,
): PaymentRequiredPayload {
	const resource: ResourceInfo = {
		url: options.resource.url,
		...(options.description ? { description: options.description } : {}),
		...(options.mimeType ? { mimeType: options.mimeType } : {}),
	};

	return {
		x402Version: 2,
		accepts: Array.isArray(options.accepts)
			? options.accepts
			: [options.accepts],
		resource,
		...(options.extensions ? { extensions: options.extensions } : {}),
	};
}

export function createPaymentRequired(
	options: CreatePaymentRequiredOptions,
): Response {
	const paymentRequired = buildPaymentRequiredPayload(options);
	const encodedPaymentRequired = encodePaymentRequiredHeader(paymentRequired);

	return new Response(JSON.stringify(paymentRequired), {
		status: 402,
		headers: {
			"Content-Type": "application/json",
			[PAYMENT_REQUIRED_HEADER]: encodedPaymentRequired,
			...(options.wwwAuthenticate
				? { "WWW-Authenticate": options.wwwAuthenticate }
				: {}),
		},
	});
}

export function parsePaymentRequiredHeader(
	paymentRequiredHeader: string,
): PaymentRequiredPayload {
	const paymentRequired = decodePaymentRequiredHeader(
		paymentRequiredHeader,
	) as PaymentRequiredPayload;

	if (paymentRequired.x402Version !== 2) {
		throw new Error(`Unsupported x402 version: ${paymentRequired.x402Version}`);
	}

	return paymentRequired;
}

export function parsePaymentSignatureHeader(
	paymentSignatureHeader: string,
): PaymentSignaturePayload {
	const paymentPayload = decodePaymentSignatureHeader(
		paymentSignatureHeader,
	) as PaymentSignaturePayload;

	if (paymentPayload.x402Version !== 2) {
		throw new Error(`Unsupported x402 version: ${paymentPayload.x402Version}`);
	}

	return paymentPayload;
}

export function encodePaymentSignatureHeader(
	paymentSignature: PaymentSignaturePayload,
): string {
	return encodeX402PaymentSignatureHeader(paymentSignature);
}

export function parsePaymentResponseHeader(
	paymentResponseHeader: string,
): SettleResponse {
	return decodePaymentResponseHeader(paymentResponseHeader);
}

export function encodePaymentResponseHeader(settlement: unknown): string {
	return encodeX402PaymentResponseHeader(settlement as SettleResponse);
}

export function asObjectRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	return value as Record<string, unknown>;
}

// ─── Zentity Proof-of-Human extensions ──────────────────────────────

/** The x402 extension that says how to authenticate for a requirement. */
export const AUTH_HINTS_EXTENSION = "auth-hints";
/** The x402 extension that carries a merchant's identity requirement. */
export const ZENTITY_EXTENSION = "zentity";
/**
 * The `WWW-Authenticate` challenge of a 402 whose resource needs a
 * Proof-of-Human token presented with DPoP (RFC 9449).
 */
export const PROOF_OF_HUMAN_CHALLENGE = 'DPoP algs="ES256"';

const AUTH_HINTS_SCHEMA = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	properties: {
		authRequirements: {
			type: "array",
			items: {
				type: "object",
				properties: {
					acceptIndexes: {
						type: "array",
						items: { type: "integer" },
						description: "Indexes into the accepts[] array",
					},
					methods: {
						type: "array",
						items: {
							type: "object",
							properties: {
								type: {
									type: "string",
									description: "Authentication method type",
								},
							},
							required: ["type"],
						},
					},
				},
				required: ["acceptIndexes", "methods"],
			},
		},
	},
	required: ["authRequirements"],
} as const;

const ZENTITY_EXTENSION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["minIdentityStrength"],
	properties: {
		minIdentityStrength: { enum: [...IDENTITY_STRENGTHS] },
		identityRegistryMirror: { type: "string" },
	},
} as const;

export interface AuthHintsOptions {
	/** The `accepts[]` entries that need the Zentity token. */
	acceptIndexes: number[];
	/** The Zentity OAuth issuer. */
	authorizationServer: string;
	/** The Zentity token endpoint. */
	tokenEndpoint: string;
}

/**
 * The `auth-hints` extension value for a 402: one `oauth2` method that names
 * Zentity and DPoP presentation.
 */
export function buildAuthHintsExtension(options: AuthHintsOptions) {
	return {
		info: {
			authRequirements: [
				{
					acceptIndexes: options.acceptIndexes,
					methods: [
						{
							type: "oauth2",
							tokenType: "DPoP",
							authorizationServer: options.authorizationServer,
							tokenEndpoint: options.tokenEndpoint,
						},
					],
				},
			],
		},
		schema: AUTH_HINTS_SCHEMA,
	};
}

export interface ZentityExtensionInfo {
	/**
	 * The identity registry mirror a resource checks on-chain. Agents cannot
	 * use such a resource.
	 */
	identityRegistryMirror?: string | undefined;
	minIdentityStrength: IdentityStrength;
}

/** The `zentity` extension value for a 402: `{ info, schema }`. */
export function buildZentityExtension(info: ZentityExtensionInfo) {
	return {
		info: {
			minIdentityStrength: info.minIdentityStrength,
			...(info.identityRegistryMirror
				? { identityRegistryMirror: info.identityRegistryMirror }
				: {}),
		},
		schema: ZENTITY_EXTENSION_SCHEMA,
	};
}

const authHintsSchema = z.object({
	info: z.object({
		authRequirements: z.array(
			z.object({
				acceptIndexes: z.array(z.number().int().nonnegative()),
				methods: z.array(z.looseObject({ type: z.string() })),
			})
		),
	}),
});

const oauthMethodSchema = z.object({
	type: z.literal("oauth2"),
	tokenType: z.string(),
	authorizationServer: z.string(),
	tokenEndpoint: z.string(),
});

const zentityExtensionSchema = z.object({
	info: z
		.object({
			minIdentityStrength: IdentityStrengthSchema,
			identityRegistryMirror: z.string().optional(),
		})
		.strict(),
});

/** One `oauth2` method of an `auth-hints` extension, with the entries it covers. */
export interface OAuthAuthHint {
	acceptIndexes: number[];
	authorizationServer: string;
	tokenEndpoint: string;
	tokenType: string;
}

/**
 * The `oauth2` methods a 402's `auth-hints` extension declares, with the
 * `accepts[]` indexes each covers (out-of-range indexes dropped). Null when
 * the extension is absent or not in the `{ info, schema }` shape.
 */
export function readOAuthAuthHints(
	paymentRequired: Pick<PaymentRequiredPayload, "accepts" | "extensions">
): OAuthAuthHint[] | null {
	const parsed = authHintsSchema.safeParse(
		paymentRequired.extensions?.[AUTH_HINTS_EXTENSION]
	);
	if (!parsed.success) {
		return null;
	}
	const acceptCount = paymentRequired.accepts.length;
	return parsed.data.info.authRequirements.flatMap((requirement) => {
		const acceptIndexes = requirement.acceptIndexes.filter(
			(index) => index < acceptCount
		);
		return requirement.methods.flatMap((method) => {
			const oauth = oauthMethodSchema.safeParse(method);
			return oauth.success ? [{ ...oauth.data, acceptIndexes }] : [];
		});
	});
}

/**
 * A 402's `zentity` extension, or null when it is absent, uses a numeric
 * level, or is not in the `{ info, schema }` shape.
 */
export function readZentityExtension(
	paymentRequired: Pick<PaymentRequiredPayload, "extensions">
): ZentityExtensionInfo | null {
	const parsed = zentityExtensionSchema.safeParse(
		paymentRequired.extensions?.[ZENTITY_EXTENSION]
	);
	return parsed.success ? parsed.data.info : null;
}
