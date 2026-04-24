import type { PaymentPayload } from "@x402/core/types";

import {
	asObjectRecord,
	attachProofOfHumanToken,
	encodePaymentSignatureHeader,
	PAYMENT_REQUIRED_HEADER,
	PAYMENT_SIGNATURE_HEADER,
	type PaymentRequiredPayload,
	type PaymentSignaturePayload,
	parsePaymentRequiredHeader,
} from "./rp/payment-required";

export interface X402ComplianceRequirement {
	identityRegistryMirror?: string;
	minComplianceLevel: number;
	pohIssuer: string;
}

export interface X402PaymentContext {
	paymentRequired: PaymentRequiredPayload;
	request: Request;
	requirement: X402ComplianceRequirement;
	/**
	 * The x402 payment requirement selected for the retry. The SDK currently
	 * chooses the first advertised requirement and uses the same requirement in
	 * the generated PAYMENT-SIGNATURE payload.
	 */
	selectedPaymentRequirement: PaymentRequiredPayload["accepts"][number];
}

export interface CreateX402FetchOptions {
	createPaymentPayload?(
		context: X402PaymentContext,
	): Promise<PaymentPayload> | PaymentPayload;
	getPohToken(
		minComplianceLevel: number,
		context: X402PaymentContext,
	): Promise<string>;
	onRetryForbidden?(context: X402PaymentContext): void;
}

export interface X402FetchOptions extends RequestInit {
	x402?: {
		autoPayWithProofOfHuman?: boolean;
	};
}

export type X402Fetch = (
	input: RequestInfo | URL,
	init?: X402FetchOptions,
) => Promise<Response>;

function parsePaymentRequired(
	headerValue: string | null,
): PaymentRequiredPayload | undefined {
	if (!headerValue) {
		return undefined;
	}

	try {
		return parsePaymentRequiredHeader(headerValue);
	} catch {
		return undefined;
	}
}

function parseComplianceRequirement(
	paymentRequired: PaymentRequiredPayload,
): X402ComplianceRequirement | undefined {
	const extension = asObjectRecord(paymentRequired.extensions?.zentity);
	if (!extension) {
		return undefined;
	}

	const pohIssuer = resolvePohIssuerResource(extension.pohIssuer);
	if (typeof extension.minComplianceLevel !== "number" || !pohIssuer) {
		return undefined;
	}

	return {
		minComplianceLevel: extension.minComplianceLevel,
		pohIssuer,
		...(typeof extension.identityRegistryMirror === "string"
			? { identityRegistryMirror: extension.identityRegistryMirror }
			: {}),
	};
}

function resolvePohIssuerResource(issuer: unknown): string | undefined {
	if (typeof issuer !== "string") {
		return undefined;
	}

	const trimmed = issuer.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		return new URL(trimmed).origin;
	} catch {
		return undefined;
	}
}

function selectPaymentRequirement(
	paymentRequired: PaymentRequiredPayload,
): PaymentRequiredPayload["accepts"][number] {
	const accepted = paymentRequired.accepts[0];
	if (!accepted) {
		throw new Error(
			"x402 PaymentRequired did not include payment requirements",
		);
	}

	return accepted;
}

function buildProofOnlyPaymentPayload(
	context: X402PaymentContext,
): PaymentSignaturePayload {
	return {
		x402Version: 2,
		resource: context.paymentRequired.resource,
		accepted: context.selectedPaymentRequirement,
		payload: {},
		...(context.paymentRequired.extensions
			? { extensions: context.paymentRequired.extensions }
			: {}),
	};
}

async function buildRetryRequest(
	request: Request,
	context: X402PaymentContext,
	pohToken: string,
	createPaymentPayload?: CreateX402FetchOptions["createPaymentPayload"],
): Promise<Request> {
	const basePaymentPayload = createPaymentPayload
		? await createPaymentPayload(context)
		: buildProofOnlyPaymentPayload(context);
	const paymentPayload = attachProofOfHumanToken(
		basePaymentPayload,
		context.paymentRequired,
		pohToken,
	);
	const headers = new Headers(request.headers);

	headers.set(
		PAYMENT_SIGNATURE_HEADER,
		encodePaymentSignatureHeader(paymentPayload),
	);

	return new Request(request, { headers });
}

function shouldHandleX402(init: X402FetchOptions | undefined): boolean {
	return init?.x402?.autoPayWithProofOfHuman !== false;
}

function stripX402Options(
	init: X402FetchOptions | undefined,
): RequestInit | undefined {
	if (!(init && "x402" in init)) {
		return init;
	}

	const { x402: _x402, ...requestInit } = init;
	return requestInit;
}

export function createX402Fetch(
	fetchFn: typeof globalThis.fetch,
	options: CreateX402FetchOptions,
): X402Fetch {
	return async (input, init) => {
		const request = new Request(input, stripX402Options(init));
		const response = await fetchFn(request.clone());

		if (response.status !== 402 || !shouldHandleX402(init)) {
			return response;
		}

		const paymentRequired = parsePaymentRequired(
			response.headers.get(PAYMENT_REQUIRED_HEADER),
		);
		if (!paymentRequired) {
			return response;
		}

		const requirement = parseComplianceRequirement(paymentRequired);
		if (!requirement) {
			return response;
		}

		const context: X402PaymentContext = {
			paymentRequired,
			request,
			requirement,
			selectedPaymentRequirement: selectPaymentRequirement(paymentRequired),
		};
		const pohToken = await options.getPohToken(
			requirement.minComplianceLevel,
			context,
		);
		const retryResponse = await fetchFn(
			await buildRetryRequest(
				request,
				context,
				pohToken,
				options.createPaymentPayload,
			),
		);

		if (retryResponse.status === 403) {
			options.onRetryForbidden?.(context);
		}

		return retryResponse;
	};
}
