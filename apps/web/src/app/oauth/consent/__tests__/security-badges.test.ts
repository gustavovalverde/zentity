import { describe, expect, it } from "vitest";

import { computeShieldColor } from "../_components/security-badges";

const DEFAULTS = {
  signingAlg: "RS256",
  isPairwise: false,
  requiresDpop: false,
  encryptionLevel: "none" as const,
};

describe("computeShieldColor", () => {
  it("returns gray for baseline (RS256, no encryption, public)", () => {
    expect(computeShieldColor(DEFAULTS)).toBe("gray");
  });

  it("returns yellow for modern signing without pairwise", () => {
    expect(computeShieldColor({ ...DEFAULTS, signingAlg: "ES256" })).toBe(
      "yellow"
    );
  });

  it("returns yellow for standard encryption", () => {
    expect(
      computeShieldColor({ ...DEFAULTS, encryptionLevel: "standard" })
    ).toBe("yellow");
  });

  it("returns yellow for PQ signing without pairwise", () => {
    expect(computeShieldColor({ ...DEFAULTS, signingAlg: "ML-DSA-65" })).toBe(
      "yellow"
    );
  });

  it("returns green for PQ signing + pairwise", () => {
    expect(
      computeShieldColor({
        ...DEFAULTS,
        signingAlg: "ML-DSA-65",
        isPairwise: true,
      })
    ).toBe("green");
  });

  it("returns green for PQ encryption + pairwise", () => {
    expect(
      computeShieldColor({
        ...DEFAULTS,
        encryptionLevel: "post-quantum",
        isPairwise: true,
      })
    ).toBe("green");
  });
});
