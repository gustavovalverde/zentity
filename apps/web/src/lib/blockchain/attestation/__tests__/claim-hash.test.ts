import { BN254_FR_MODULUS } from "@aztec/bb.js";
import { describe, expect, it, vi } from "vitest";

// Mock server-only for test environment
vi.mock("server-only", () => ({}));

import { getDocumentHashField } from "@/lib/blockchain/attestation/claim-hash";

describe("claim-hash", () => {
  it("reduces document hash into the field range", () => {
    const maxHash =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const field = getDocumentHashField(maxHash);
    expect(field.startsWith("0x")).toBe(true);
    const fieldValue = BigInt(field);
    expect(fieldValue).toBeLessThan(BN254_FR_MODULUS);
  });
});
