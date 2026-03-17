import { describe, expect, it } from "vitest";

import { deriveSecurityBadges } from "../_components/client-security-badges";
import { computeShieldColor } from "../_components/security-badges";

const DEFAULTS = {
  signingAlg: "RS256",
  isPairwise: false,
  requiresDpop: false,
  encryptionLevel: "none" as const,
};

describe("deriveSecurityBadges", () => {
  it("returns empty for default RS256 non-pairwise non-dpop no-encryption", () => {
    const badges = deriveSecurityBadges(DEFAULTS);
    expect(badges).toHaveLength(0);
  });

  it("includes signing alg badge for non-RS256", () => {
    const badges = deriveSecurityBadges({ ...DEFAULTS, signingAlg: "ES256" });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("ES256");
    expect(badges[0]?.tooltip).toContain("ES256");
  });

  it("includes EdDSA badge", () => {
    const badges = deriveSecurityBadges({ ...DEFAULTS, signingAlg: "EdDSA" });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("EdDSA");
  });

  it("includes ML-DSA-65 plus post-quantum badge", () => {
    const badges = deriveSecurityBadges({
      ...DEFAULTS,
      signingAlg: "ML-DSA-65",
    });
    expect(badges).toHaveLength(2);
    expect(badges[0]?.label).toBe("ML-DSA-65");
    expect(badges[1]?.label).toBe("Post-Quantum");
  });

  it("includes encryption badge for standard encryption", () => {
    const badges = deriveSecurityBadges({
      ...DEFAULTS,
      encryptionLevel: "standard",
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("Encrypted");
    expect(badges[0]?.tooltip).toContain("AES-GCM");
  });

  it("includes PQ encryption badge for ML-KEM-768", () => {
    const badges = deriveSecurityBadges({
      ...DEFAULTS,
      encryptionLevel: "post-quantum",
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("PQ Encrypted");
    expect(badges[0]?.tooltip).toContain("ML-KEM-768");
  });

  it("includes pairwise badge", () => {
    const badges = deriveSecurityBadges({ ...DEFAULTS, isPairwise: true });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("Unlinkable ID");
    expect(badges[0]?.tooltip).toContain("correlated");
  });

  it("includes DPoP badge", () => {
    const badges = deriveSecurityBadges({ ...DEFAULTS, requiresDpop: true });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("Proof-of-Possession");
  });

  it("includes all badges when all conditions met", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "ML-DSA-65",
      isPairwise: true,
      requiresDpop: true,
      encryptionLevel: "post-quantum",
    });
    expect(badges).toHaveLength(5);
    const labels = badges.map((b) => b.label);
    expect(labels).toContain("ML-DSA-65");
    expect(labels).toContain("Post-Quantum");
    expect(labels).toContain("PQ Encrypted");
    expect(labels).toContain("Unlinkable ID");
    expect(labels).toContain("Proof-of-Possession");
  });
});

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
