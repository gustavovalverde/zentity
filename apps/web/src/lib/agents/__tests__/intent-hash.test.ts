/**
 * Cross-language conformance: this TypeScript intent hash must match the Rust
 * side at `zally-core::intent_hash::tests::conformance_vector_zcash_testnet_minimal`.
 *
 * If this test fails, either:
 * - The byte layout changed on one side and not the other (wire break).
 * - A length prefix, endianness, or domain-separator string changed.
 *
 * Fix path: align both sides, regenerate the expected digest, update BOTH
 * conformance vectors in lockstep.
 */

import { describe, expect, it } from "vitest";

import {
  IntentHashError,
  type IntentInput,
  intentHash,
  intentHashFromWireString,
  intentHashToWireString,
  ZCASH_TESTNET_MINIMAL_VECTOR,
} from "../intent-hash";

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("intent-hash", () => {
  it("matches the zally-core conformance vector for the canonical Zcash testnet input", () => {
    const digest = intentHash(ZCASH_TESTNET_MINIMAL_VECTOR.input);
    expect(toHex(digest)).toBe(ZCASH_TESTNET_MINIMAL_VECTOR.expectedDigestHex);
  });

  it("changes when the recipient changes", () => {
    const base: IntentInput = {
      chainNamespace: "zcash",
      chainReference: "test",
      recipientCaip10: "zcash:test:address_a",
      amountValue: 1,
      amountUnit: "base",
      paymentId: "01HX...",
      expiryHeight: 1,
    };
    const other: IntentInput = {
      ...base,
      recipientCaip10: "zcash:test:address_b",
    };
    expect(toHex(intentHash(base))).not.toBe(toHex(intentHash(other)));
  });

  it("length prefixes defeat the byte-shift collision attack", () => {
    const ab_cd: IntentInput = {
      chainNamespace: "ab",
      chainReference: "cd",
      recipientCaip10: "x",
      amountValue: 0,
      amountUnit: "base",
      paymentId: "x",
      expiryHeight: 0,
    };
    const a_bcd: IntentInput = {
      ...ab_cd,
      chainNamespace: "a",
      chainReference: "bcd",
    };
    expect(toHex(intentHash(ab_cd))).not.toBe(toHex(intentHash(a_bcd)));
  });

  it("encodes wire form with the v1:sha256: prefix and round-trips", () => {
    const digest = intentHash(ZCASH_TESTNET_MINIMAL_VECTOR.input);
    const wire = intentHashToWireString(digest);
    expect(wire.startsWith("v1:sha256:")).toBe(true);
    const back = intentHashFromWireString(wire);
    expect(toHex(back)).toBe(toHex(digest));
  });

  it("rejects an unsupported wire version", () => {
    expect(() => intentHashFromWireString("v2:sha256:abc")).toThrow(
      IntentHashError
    );
  });

  it("accepts both number and bigint for amount and expiry", () => {
    const input: IntentInput = {
      chainNamespace: "zcash",
      chainReference: "test",
      recipientCaip10: "zcash:test:y",
      amountValue: 12_345,
      amountUnit: "base",
      paymentId: "p",
      expiryHeight: 99,
    };
    const inputBig: IntentInput = {
      ...input,
      amountValue: 12345n,
      expiryHeight: 99n,
    };
    expect(toHex(intentHash(input))).toBe(toHex(intentHash(inputBig)));
  });
});
