/**
 * The Rich Authorization Request (RFC 9396) types Zentity registers, and the
 * Agent-Assertion `task_hash` that binds an agent's signature to the whole
 * CIBA request it sends.
 */

import { parseStrictJson } from "./json-strict";
import {
	PAYMENT_AUTHORIZATION_TYPE,
	PaymentAuthorizationSchema,
} from "./payment-authorization";
import {
	PURCHASE_TYPE,
	PurchaseAuthorizationSchema,
	X402_PURCHASE_TYPE,
	X402PurchaseAuthorizationSchema,
} from "./purchase-authorization";

/**
 * Each registered type and its strict schema. The authorization server
 * registers exactly these types and advertises their names in
 * `authorization_details_types_supported`.
 */
export const AUTHORIZATION_DETAILS_TYPES = {
	[PAYMENT_AUTHORIZATION_TYPE]: PaymentAuthorizationSchema,
	[PURCHASE_TYPE]: PurchaseAuthorizationSchema,
	[X402_PURCHASE_TYPE]: X402PurchaseAuthorizationSchema,
} as const;

export type AuthorizationDetailsType = keyof typeof AUTHORIZATION_DETAILS_TYPES;

// In a `u` regex a surrogate pair is one code point, so only a lone half
// matches.
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * Serializes a JSON value canonically: strings, booleans, safe integers,
 * arrays, and objects with keys sorted by UTF-16 code units. On that domain
 * the output equals RFC 8785 (JCS) §3.2. Anything else (null, a fraction, a
 * lone surrogate, a non-plain object) throws, so a value outside the domain
 * can never hash to the same bytes as one inside it.
 */
export function canonicalJson(value: unknown): string {
	if (typeof value === "string") {
		if (LONE_SURROGATE.test(value)) {
			throw new TypeError("canonicalJson: string has a lone surrogate");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new TypeError(`canonicalJson: ${value} is not a safe integer`);
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (
		value !== null &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		const record = value as Record<string, unknown>;
		const members = Object.keys(record)
			.sort()
			.map((key) => `${canonicalJson(key)}:${canonicalJson(record[key])}`);
		return `{${members.join(",")}}`;
	}
	throw new TypeError(`canonicalJson: unsupported value ${String(value)}`);
}

export interface TaskHashInput {
	/** `acr_values` as sent: a space-separated string or the list in order. */
	acrValues?: string | readonly string[] | null | undefined;
	/** `authorization_details` as a JSON string or the parsed array. */
	authorizationDetails?: string | readonly unknown[] | null | undefined;
	bindingMessage: string;
	/** `scope` as a space-separated string or a list. */
	scope: string | readonly string[];
}

function splitList(value: string | readonly string[]): string[] {
	return typeof value === "string"
		? value.split(/\s+/).filter(Boolean)
		: [...value];
}

/**
 * The normalized request an Agent-Assertion signs. Scopes are sorted and
 * de-duplicated, `acr_values` keep their order, and empty lists are left out,
 * matching how the authorization server stores the request.
 */
export function taskHashPayload(input: TaskHashInput): Record<string, unknown> {
	const scope = [...new Set(splitList(input.scope))].sort();
	const acrValues = input.acrValues ? splitList(input.acrValues) : [];
	const details =
		typeof input.authorizationDetails === "string"
			? parseStrictJson(input.authorizationDetails)
			: input.authorizationDetails;
	if (details !== undefined && details !== null && !Array.isArray(details)) {
		throw new TypeError("authorization_details must be a JSON array");
	}
	return {
		binding_message: input.bindingMessage,
		scope,
		...(acrValues.length > 0 ? { acr_values: acrValues } : {}),
		...(details && details.length > 0
			? { authorization_details: details }
			: {}),
	};
}

/**
 * `task_hash`: hex SHA-256 of the canonical JSON of {@link taskHashPayload}.
 * The authorization server recomputes it from the stored request, so an
 * assertion signed over one request cannot bind another.
 */
export async function taskHash(input: TaskHashInput): Promise<string> {
	const bytes = new TextEncoder().encode(
		canonicalJson(taskHashPayload(input)),
	);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}
