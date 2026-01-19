import { describe, expect, it } from "vitest";

import { normalizeChallengeNonce } from "../proof-types";

describe("normalizeChallengeNonce", () => {
  it("normalizes a 32-byte hex field element to a 16-byte nonce", () => {
    // 0x000...0001 -> 1
    const field =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    expect(normalizeChallengeNonce(field)).toBe(
      "00000000000000000000000000000001"
    );
  });

  it("preserves leading zeros from the low 128 bits", () => {
    const field =
      "0x00000000000000000000000000000000d71e131171721565373781d55af916b6";
    expect(normalizeChallengeNonce(field)).toBe(
      "d71e131171721565373781d55af916b6"
    );
  });

  it("normalizes decimal strings", () => {
    expect(normalizeChallengeNonce("1")).toBe(
      "00000000000000000000000000000001"
    );
  });
});
