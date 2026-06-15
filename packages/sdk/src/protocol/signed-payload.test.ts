/**
 * Conformance for the `signed_payload` wire envelope.
 *
 * This is the artifact the wallet returns from `/v1/payments/sign` and the
 * facilitator consumes at `/settle`. The `format` union must stay
 * exhaustive across the `raw-zcash-v5` → `pczt-v1` flip (Proposal-0003
 * D-3 / PRD-43 D-B); an importer's `switch` on `format` relies on it.
 */

import { describe, expect, it } from "vitest";

import {
	SIGNED_PAYLOAD_FORMAT_PCZT_V1,
	SIGNED_PAYLOAD_FORMAT_RAW_V5,
	type SignedPayload,
	SignedPayloadFormatSchema,
	SignedPayloadSchema,
} from "./signed-payload";

const VALID_RAW_V5: SignedPayload = {
	format: SIGNED_PAYLOAD_FORMAT_RAW_V5,
	bytes: "AQID",
	tx_id: "c9180b80febfb19e92a68ed7964154f5dd78338b13f7c656e8799af73755c209",
	fee: { currency: "ZEC", value: "1000", unit: "base" },
	expires_at: { kind: "block_height", value: 4_056_276 },
};

describe("SignedPayloadFormatSchema", () => {
	it("accepts both format literals", () => {
		expect(SignedPayloadFormatSchema.parse(SIGNED_PAYLOAD_FORMAT_RAW_V5)).toBe(
			"raw-zcash-v5",
		);
		expect(SignedPayloadFormatSchema.parse(SIGNED_PAYLOAD_FORMAT_PCZT_V1)).toBe(
			"pczt-v1",
		);
	});

	it("rejects an unknown format", () => {
		expect(() => SignedPayloadFormatSchema.parse("raw-zcash-v4")).toThrow();
	});
});

describe("SignedPayloadSchema", () => {
	it("round-trips a raw-zcash-v5 payload", () => {
		const parsed = SignedPayloadSchema.parse(VALID_RAW_V5);
		expect(parsed.format).toBe("raw-zcash-v5");
		expect(parsed.tx_id).toBe(VALID_RAW_V5.tx_id);
		expect(parsed.fee.unit).toBe("base");
	});

	it("accepts a pczt-v1 payload with optional metadata", () => {
		const parsed = SignedPayloadSchema.parse({
			...VALID_RAW_V5,
			format: SIGNED_PAYLOAD_FORMAT_PCZT_V1,
			metadata: { "zentity.final": true },
		});
		expect(parsed.format).toBe("pczt-v1");
		expect(parsed.metadata?.["zentity.final"]).toBe(true);
	});

	it("rejects an empty bytes field", () => {
		expect(() =>
			SignedPayloadSchema.parse({ ...VALID_RAW_V5, bytes: "" }),
		).toThrow();
	});

	it("rejects an unknown format on the full envelope", () => {
		expect(() =>
			SignedPayloadSchema.parse({ ...VALID_RAW_V5, format: "raw-zcash-v4" }),
		).toThrow();
	});
});
