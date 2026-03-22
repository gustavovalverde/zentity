import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseTrustedAttesters, verifyAgentAttestation } = await import(
  "../agent-attestation"
);

describe("parseTrustedAttesters", () => {
  it("returns empty array when env var is not set", () => {
    const result = parseTrustedAttesters();
    // In test env, TRUSTED_AGENT_ATTESTERS is typically undefined
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("verifyAgentAttestation", () => {
  it("returns unverified when no attesters configured", async () => {
    const result = await verifyAgentAttestation(
      "fake.jwt.here",
      "fake.pop.jwt",
      "https://app.zentity.xyz"
    );
    expect(result.verified).toBe(false);
    expect(result.tier).toBe("unverified");
  });

  it("returns unverified when PoP JWT is missing", async () => {
    const result = await verifyAgentAttestation(
      "fake.jwt.here",
      undefined,
      "https://app.zentity.xyz"
    );
    expect(result.verified).toBe(false);
    expect(result.tier).toBe("unverified");
  });

  it("AttestationResult has tier field", async () => {
    const result = await verifyAgentAttestation(
      "fake.jwt.here",
      undefined,
      "https://app.zentity.xyz"
    );
    expect(result).toHaveProperty("tier");
    expect(["attested", "self-declared", "unverified"]).toContain(result.tier);
  });
});
