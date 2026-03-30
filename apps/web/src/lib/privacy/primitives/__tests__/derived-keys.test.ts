import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", async (importOriginal) => importOriginal());

const HEX_64_RE = /^[0-9a-f]{64}$/;

import {
  getCiphertextHmacKey,
  getClaimSigningKey,
  getConsentHmacKey,
  getIdentityIntentKey,
  getOpaqueStateKey,
} from "../derived-keys";

describe("derived-keys", () => {
  it("all 5 keys are distinct from each other", () => {
    const keys = [
      Buffer.from(getClaimSigningKey()).toString("hex"),
      getCiphertextHmacKey().toString("hex"),
      getOpaqueStateKey(),
      getConsentHmacKey(),
      getIdentityIntentKey(),
    ];

    const unique = new Set(keys);
    expect(unique.size).toBe(5);
  });

  it("same accessor returns same value (caching)", () => {
    const a = getClaimSigningKey();
    const b = getClaimSigningKey();
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));

    expect(getConsentHmacKey()).toBe(getConsentHmacKey());
    expect(getOpaqueStateKey()).toBe(getOpaqueStateKey());
  });

  it("claim signing key is 32 bytes", () => {
    expect(getClaimSigningKey().byteLength).toBe(32);
  });

  it("ciphertext HMAC key is 32 bytes", () => {
    expect(getCiphertextHmacKey().byteLength).toBe(32);
  });

  it("HKDF-derived keys are hex strings of 64 chars (32 bytes)", () => {
    expect(getOpaqueStateKey()).toMatch(HEX_64_RE);
    expect(getConsentHmacKey()).toMatch(HEX_64_RE);
    expect(getIdentityIntentKey()).toMatch(HEX_64_RE);
  });
});
