import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { verifyAgentAttestation } = await import(
  "../../agents/agent-attestation"
);

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
