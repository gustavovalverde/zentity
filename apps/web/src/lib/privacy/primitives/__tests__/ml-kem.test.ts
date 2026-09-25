import { describe, expect, it } from "vitest";

import { isValidMlKemPublicKey } from "@/lib/privacy/primitives/post-quantum";

describe("isValidMlKemPublicKey", () => {
  it("accepts a 1184-byte key as base64", () => {
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(1184)));
    expect(isValidMlKemPublicKey(key.toString("base64"))).toBe(true);
  });

  it("rejects 32-byte X25519 key (old format)", () => {
    const oldKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
    expect(isValidMlKemPublicKey(oldKey.toString("base64"))).toBe(false);
  });

  it("rejects non-base64 string", () => {
    expect(isValidMlKemPublicKey("not-valid-base64!!!")).toBe(false);
  });
});
