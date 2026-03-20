import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    TRUSTED_AGENT_ATTESTERS: "",
  },
}));

// Import AFTER mock is set up
const { normalizeAgentClaims } = await import("../agent-attestation");

describe("normalizeAgentClaims", () => {
  it("returns undefined for undefined input", async () => {
    const result = await normalizeAgentClaims(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it("strips self-injected attestation from agent claims", async () => {
    const spoofed = JSON.stringify({
      agent: { name: "Evil Agent" },
      attestation: { verified: true, issuer: "spoofed" },
    });

    const result = await normalizeAgentClaims(spoofed, undefined);
    const parsed = JSON.parse(result as string) as Record<string, unknown>;

    expect(parsed.agent).toEqual({ name: "Evil Agent" });
    expect(parsed.attestation).toBeUndefined();
  });

  it("preserves agent and task fields while stripping attestation", async () => {
    const claims = JSON.stringify({
      agent: { name: "Aether AI", model: "gpt-4" },
      task: { id: "headphones", description: "Find headphones" },
      attestation: { verified: true, issuer: "fake" },
    });

    const result = await normalizeAgentClaims(claims, undefined);
    const parsed = JSON.parse(result as string) as Record<string, unknown>;

    expect(parsed.agent).toEqual({ name: "Aether AI", model: "gpt-4" });
    expect(parsed.task).toEqual({
      id: "headphones",
      description: "Find headphones",
    });
    expect(parsed.attestation).toBeUndefined();
  });

  it("returns original string for malformed JSON", async () => {
    const malformed = "not valid json{";
    const result = await normalizeAgentClaims(malformed, undefined);
    expect(result).toBe(malformed);
  });

  it("does not add attestation when no headers present", async () => {
    const claims = JSON.stringify({
      agent: { name: "Aether AI" },
    });
    const request = new Request("https://example.com", {
      method: "POST",
    });

    const result = await normalizeAgentClaims(claims, request);
    const parsed = JSON.parse(result as string) as Record<string, unknown>;

    expect(parsed.agent).toEqual({ name: "Aether AI" });
    expect(parsed.attestation).toBeUndefined();
  });

  it("does not add attestation when only one header is present", async () => {
    const claims = JSON.stringify({
      agent: { name: "Aether AI" },
    });
    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "OAuth-Client-Attestation": "some-jwt",
      },
    });

    const result = await normalizeAgentClaims(claims, request);
    const parsed = JSON.parse(result as string) as Record<string, unknown>;

    expect(parsed.attestation).toBeUndefined();
  });

  it("does not add attestation when TRUSTED_AGENT_ATTESTERS is empty", async () => {
    const claims = JSON.stringify({
      agent: { name: "Aether AI" },
    });
    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "OAuth-Client-Attestation": "some-jwt",
        "OAuth-Client-Attestation-PoP": "some-pop-jwt",
      },
    });

    const result = await normalizeAgentClaims(claims, request);
    const parsed = JSON.parse(result as string) as Record<string, unknown>;

    expect(parsed.attestation).toBeUndefined();
  });

  it("spoofed attestation is always stripped even with headers present", async () => {
    const claims = JSON.stringify({
      agent: { name: "Aether AI" },
      attestation: {
        verified: true,
        issuer: "fake-issuer",
        verifiedAt: "2026-01-01",
      },
    });
    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "OAuth-Client-Attestation": "invalid-jwt",
        "OAuth-Client-Attestation-PoP": "invalid-pop",
      },
    });

    const result = await normalizeAgentClaims(claims, request);
    const parsed = JSON.parse(result as string) as Record<string, unknown>;

    // Spoofed attestation must be stripped; no valid JWKS means no real attestation added
    expect(parsed.attestation).toBeUndefined();
    expect(parsed.agent).toEqual({ name: "Aether AI" });
  });
});
