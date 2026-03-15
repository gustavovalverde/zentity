import { describe, expect, it } from "vitest";

import { deriveSecurityBadges } from "../_components/client-security-badges";

describe("deriveSecurityBadges", () => {
  it("returns empty for default RS256 non-pairwise non-dpop", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "RS256",
      isPairwise: false,
      requiresDpop: false,
    });
    expect(badges).toHaveLength(0);
  });

  it("includes signing alg badge for non-RS256", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "ES256",
      isPairwise: false,
      requiresDpop: false,
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("ES256");
    expect(badges[0]?.tooltip).toContain("ES256");
  });

  it("includes EdDSA badge", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "EdDSA",
      isPairwise: false,
      requiresDpop: false,
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("EdDSA");
  });

  it("includes ML-DSA-65 plus post-quantum badge", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "ML-DSA-65",
      isPairwise: false,
      requiresDpop: false,
    });
    expect(badges).toHaveLength(2);
    expect(badges[0]?.label).toBe("ML-DSA-65");
    expect(badges[1]?.label).toBe("Post-Quantum");
  });

  it("includes pairwise badge", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "RS256",
      isPairwise: true,
      requiresDpop: false,
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("Unlinkable ID");
    expect(badges[0]?.tooltip).toContain("correlated");
  });

  it("includes DPoP badge", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "RS256",
      isPairwise: false,
      requiresDpop: true,
    });
    expect(badges).toHaveLength(1);
    expect(badges[0]?.label).toBe("Proof-of-Possession");
  });

  it("includes all badges when all conditions met", () => {
    const badges = deriveSecurityBadges({
      signingAlg: "ML-DSA-65",
      isPairwise: true,
      requiresDpop: true,
    });
    expect(badges).toHaveLength(4);
    const labels = badges.map((b) => b.label);
    expect(labels).toContain("ML-DSA-65");
    expect(labels).toContain("Post-Quantum");
    expect(labels).toContain("Unlinkable ID");
    expect(labels).toContain("Proof-of-Possession");
  });
});
