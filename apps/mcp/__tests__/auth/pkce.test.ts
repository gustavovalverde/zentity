import { describe, expect, it } from "vitest";
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generatePkce,
} from "../../src/auth/pkce.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

describe("PKCE", () => {
  it("generates a code verifier of valid length", () => {
    const verifier = generateCodeVerifier();
    // Base64url of 32 bytes = 43 chars
    expect(verifier.length).toBe(43);
    expect(verifier).toMatch(BASE64URL_PATTERN);
  });

  it("generates unique verifiers", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  it("computes S256 code challenge", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);
    // SHA-256 hash base64url encoded = 43 chars
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(BASE64URL_PATTERN);
  });

  it("challenge is deterministic for same verifier", async () => {
    const verifier = generateCodeVerifier();
    const c1 = await computeCodeChallenge(verifier);
    const c2 = await computeCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it("generatePkce returns all required fields", async () => {
    const pkce = await generatePkce();
    expect(pkce.codeVerifier).toBeDefined();
    expect(pkce.codeChallenge).toBeDefined();
    expect(pkce.codeChallengeMethod).toBe("S256");
  });
});
