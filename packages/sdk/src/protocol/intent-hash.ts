/**
 * Parsed-tuple intent binding for the OAuth `payment_authorization` RAR.
 *
 * TypeScript mirror of `zally-core/src/intent_hash.rs`. The issuer
 * (zentity) and the wallet runtime (zspend-runtime, in zpay's workspace)
 * MUST produce the same SHA-256 digest for the same parsed tuple;
 * otherwise the wallet rejects the issuer's signed authorization and no
 * spend goes through.
 *
 * # Byte layout (locked)
 *
 * ```text
 *   "zentity.payauth.v1"               domain separator (18 bytes)
 *   u16-be(chain_namespace.len()) || chain_namespace.as_bytes()
 *   u16-be(chain_reference.len()) || chain_reference.as_bytes()
 *   u16-be(recipient_caip10.len()) || recipient_caip10.as_bytes()
 *   amount_value as u64 big-endian   8 bytes
 *   amount_unit                      1 byte (0x00 Base, 0x01 Display)
 *   u16-be(payment_id.len()) || payment_id.as_bytes()
 *   expiry_height as u64 big-endian  8 bytes
 * ```
 *
 * # Conformance
 *
 * {@link ZCASH_TESTNET_MINIMAL_VECTOR} is the canonical conformance vector;
 * `zally-core::intent_hash::tests::conformance_vector_zcash_testnet_minimal`
 * asserts the same expected digest. A vector mismatch in CI is the wire
 * break this test exists to catch.
 *
 * Per Proposal-0003 D-4 in
 * `/Users/gustavovalverde/dev/zfnd/zpay/docs/proposals/0003-agent-wallet-production-architecture.md`.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "jose";

export const INTENT_HASH_DOMAIN_SEPARATOR = "zentity.payauth.v1";
export const INTENT_HASH_WIRE_PREFIX = "v1:sha256:";

const MAX_FIELD_LEN = 0xff_ff;

export type AmountUnit = "base" | "display";

export interface IntentInput {
	amountUnit: AmountUnit;
	amountValue: number | bigint;
	chainNamespace: string;
	chainReference: string;
	expiryHeight: number | bigint;
	paymentId: string;
	recipientCaip10: string;
}

export class IntentHashError extends Error {
	readonly kind: "field-too-long" | "unsupported-version" | "payload-invalid";
	constructor(kind: IntentHashError["kind"], message: string) {
		super(message);
		this.kind = kind;
		this.name = "IntentHashError";
	}
}

export function intentHash(input: IntentInput): Uint8Array {
	const parts: Uint8Array[] = [];

	parts.push(new TextEncoder().encode(INTENT_HASH_DOMAIN_SEPARATOR));
	parts.push(lenPrefixed("chainNamespace", input.chainNamespace));
	parts.push(lenPrefixed("chainReference", input.chainReference));
	parts.push(lenPrefixed("recipientCaip10", input.recipientCaip10));
	parts.push(u64BigEndian(input.amountValue));
	parts.push(Uint8Array.of(amountUnitByte(input.amountUnit)));
	parts.push(lenPrefixed("paymentId", input.paymentId));
	parts.push(u64BigEndian(input.expiryHeight));

	const hash = sha256.create();
	for (const part of parts) {
		hash.update(part);
	}
	return hash.digest();
}

export function intentHashToWireString(digest: Uint8Array): string {
	if (digest.length !== 32) {
		throw new IntentHashError(
			"payload-invalid",
			`expected 32 bytes, got ${digest.length}`,
		);
	}
	return INTENT_HASH_WIRE_PREFIX + base64url.encode(digest);
}

export function intentHashFromWireString(s: string): Uint8Array {
	if (!s.startsWith(INTENT_HASH_WIRE_PREFIX)) {
		throw new IntentHashError(
			"unsupported-version",
			"intent hash version not supported (expected v1:sha256:)",
		);
	}
	const encoded = s.slice(INTENT_HASH_WIRE_PREFIX.length);
	let raw: Uint8Array;
	try {
		raw = base64url.decode(encoded);
	} catch (err) {
		throw new IntentHashError(
			"payload-invalid",
			`base64url decode failed: ${(err as Error).message}`,
		);
	}
	if (raw.length !== 32) {
		throw new IntentHashError(
			"payload-invalid",
			`expected 32 bytes, got ${raw.length}`,
		);
	}
	return new Uint8Array(raw);
}

function lenPrefixed(field: string, value: string): Uint8Array {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length > MAX_FIELD_LEN) {
		throw new IntentHashError(
			"field-too-long",
			`intent field ${field} too long: ${bytes.length} bytes (max ${MAX_FIELD_LEN})`,
		);
	}
	const result = new Uint8Array(2 + bytes.length);
	new DataView(result.buffer).setUint16(0, bytes.length, false);
	result.set(bytes, 2);
	return result;
}

function u64BigEndian(value: number | bigint): Uint8Array {
	const big = typeof value === "bigint" ? value : BigInt(value);
	if (big < 0n || big > 0xffff_ffff_ffff_ffffn) {
		throw new RangeError("value out of range for u64");
	}
	const result = new Uint8Array(8);
	new DataView(result.buffer).setBigUint64(0, big, false);
	return result;
}

function amountUnitByte(unit: AmountUnit): number {
	return unit === "base" ? 0x00 : 0x01;
}

export const ZCASH_TESTNET_MINIMAL_VECTOR = {
	input: {
		chainNamespace: "zcash",
		chainReference: "test",
		recipientCaip10: "zcash:test:utest1qq...",
		amountValue: 50_000_000,
		amountUnit: "base" as AmountUnit,
		paymentId: "01KT9A0V431VGD5YH7R7G635HC",
		expiryHeight: 4_047_100,
	},
	expectedDigestHex:
		"b47e481896e757a3714a5f679b06c573c1160c5eab7d871780e7c71669888d44",
} as const;
