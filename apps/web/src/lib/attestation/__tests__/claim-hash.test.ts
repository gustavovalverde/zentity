import { Fr } from "@aztec/bb.js";
import { describe, expect, it } from "vitest";

import { getDocumentHashField } from "@/lib/attestation/claim-hash";

describe("claim-hash", () => {
  it("reduces document hash into the field range", async () => {
    const maxHash =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const field = await getDocumentHashField(maxHash);
    expect(field.startsWith("0x")).toBe(true);
    const fieldValue = BigInt(field);
    expect(fieldValue).toBeLessThan(Fr.MODULUS);
  });
});
