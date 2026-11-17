import { BN254_FR_MODULUS } from "@aztec-foundation/bb.js";
import { describe, expect, it, vi } from "vitest";

// Mock server-only for test environment
vi.mock("server-only", () => ({}));

import {
  computeClaimHash,
  getDocumentHashField,
} from "@/lib/blockchain/attestation/claim-hash";

describe("claim-hash", () => {
  it("maps document hash into the field range", async () => {
    const maxHash =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const field = await getDocumentHashField(maxHash);
    expect(field.startsWith("0x")).toBe(true);
    const fieldValue = BigInt(field);
    expect(fieldValue).toBeLessThan(BN254_FR_MODULUS);
  });

  it("returns the 32-byte Poseidon2 hash as 0x-prefixed hex", async () => {
    // Poseidon2([1, 2]) from the barretenberg test vector, 32-byte padded.
    await expect(
      computeClaimHash({ value: 1, documentHashField: "0x2" })
    ).resolves.toBe(
      `0x${1594597865669602199208529098208508950092942746041644072252494753744672355203n.toString(16).padStart(64, "0")}`
    );
  }, 60_000);
});
