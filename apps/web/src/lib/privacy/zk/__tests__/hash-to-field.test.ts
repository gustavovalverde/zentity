import { describe, expect, it } from "vitest";

import { BN254_FR_MODULUS } from "@/lib/privacy/zk/proof-types";

import {
  HASH_TO_FIELD_INFO,
  hashToFieldHexFromHex,
  hashToFieldHexFromString,
  normalizeFieldHex,
} from "../hash-to-field";

describe("hash-to-field", () => {
  it("maps values into the BN254 field", async () => {
    const mapped = await hashToFieldHexFromHex(
      `0x${"ff".repeat(32)}`,
      HASH_TO_FIELD_INFO.DOCUMENT_HASH
    );
    expect(BigInt(mapped)).toBeLessThan(BN254_FR_MODULUS);
  });

  it("is deterministic for same input and info", async () => {
    const input = "user-123";
    const info = HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER;
    const [first, second] = await Promise.all([
      hashToFieldHexFromString(input, info),
      hashToFieldHexFromString(input, info),
    ]);

    expect(first).toBe(second);
  });

  it("uses domain separation", async () => {
    const input = "user-123";
    const [msgSenderField, audienceField] = await Promise.all([
      hashToFieldHexFromString(input, HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER),
      hashToFieldHexFromString(input, HASH_TO_FIELD_INFO.IDENTITY_AUDIENCE),
    ]);

    expect(msgSenderField).not.toBe(audienceField);
  });

  it("does not use direct 256-bit modulo reduction", async () => {
    const raw = `0x${"ff".repeat(32)}`;
    const mapped = await hashToFieldHexFromHex(
      raw,
      HASH_TO_FIELD_INFO.DOCUMENT_HASH
    );
    const directModulo = BigInt(raw) % BN254_FR_MODULUS;

    expect(BigInt(mapped)).not.toBe(directModulo);
  });

  it("matches independent HKDF-SHA256 (zero salt, 512-bit) vectors", async () => {
    await expect(
      hashToFieldHexFromString(
        "user-123",
        HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER
      )
    ).resolves.toBe(
      "0x0ee50d6ae43840c38233dc7292d694ca187caae9e843545bb5631601a2cebd6f"
    );
    await expect(
      hashToFieldHexFromHex(
        `0x${"ff".repeat(32)}`,
        HASH_TO_FIELD_INFO.DOCUMENT_HASH
      )
    ).resolves.toBe(
      "0x150f99babe24e1e4966332e11576ac9a4e14c1095c9e046094050f5cbca2b033"
    );
  });

  it("normalizes field hex to canonical width", () => {
    expect(normalizeFieldHex("0x1")).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
  });
});
