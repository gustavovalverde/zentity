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
}

export function buildPaymentRequiredPayload(
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

export function attachProofOfHumanToken(
	paymentPayload: PaymentPayload,
	paymentRequired: PaymentRequiredPayload,
	pohToken: string,
): PaymentSignaturePayload {
	const declaredZentity = asObjectRecord(paymentRequired.extensions?.zentity);
	const payloadZentity = asObjectRecord(paymentPayload.extensions?.zentity);

	return {
		...paymentPayload,
		x402Version: 2,
		extensions: {
			...paymentPayload.extensions,
			zentity: {
				...declaredZentity,
				...payloadZentity,
				pohToken,
			},
		},
	} as PaymentSignaturePayload;
}
