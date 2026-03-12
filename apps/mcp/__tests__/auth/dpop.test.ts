import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDpopProof,
  extractDpopNonce,
  getOrCreateDpopKey,
} from "../../src/auth/dpop.js";

vi.mock("../../src/auth/credentials.js", () => {
  let stored: Record<string, unknown> | undefined;
  return {
    loadCredentials: () => stored,
    updateCredentials: (_url: string, updates: Record<string, unknown>) => {
      stored = {
        zentityUrl: "http://localhost:3000",
        clientId: "",
        ...stored,
        ...updates,
      };
      return stored;
    },
  };
});

describe("DPoP", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and returns a DPoP keypair", async () => {
    const key = await getOrCreateDpopKey("http://localhost:3000");
    expect(key.privateJwk).toBeDefined();
    expect(key.publicJwk).toBeDefined();
    expect(key.publicJwk.kty).toBe("EC");
    expect(key.publicJwk.crv).toBe("P-256");
  });

  it("creates a valid DPoP proof JWT", async () => {
    const key = await getOrCreateDpopKey("http://localhost:3000");
    const proof = await createDpopProof(
      key,
      "POST",
      "https://example.com/token"
    );

    const header = decodeProtectedHeader(proof);
    expect(header.alg).toBe("ES256");
    expect(header.typ).toBe("dpop+jwt");
    expect(header.jwk).toBeDefined();

    const payload = decodeJwt(proof);
    expect(payload.htm).toBe("POST");
    expect(payload.htu).toBe("https://example.com/token");
    expect(payload.jti).toBeDefined();
    expect(payload.iat).toBeDefined();
  });

  it("includes ath claim when access token is provided", async () => {
    const key = await getOrCreateDpopKey("http://localhost:3000");
    const proof = await createDpopProof(
      key,
      "GET",
      "https://example.com/api",
      "test-token"
    );

    const payload = decodeJwt(proof);
    expect(payload.ath).toBeDefined();
    expect(typeof payload.ath).toBe("string");
  });

  it("includes nonce when provided", async () => {
    const key = await getOrCreateDpopKey("http://localhost:3000");
    const proof = await createDpopProof(
      key,
      "POST",
      "https://example.com/token",
      undefined,
      "server-nonce"
    );

    const payload = decodeJwt(proof);
    expect(payload.nonce).toBe("server-nonce");
  });

  it("extracts DPoP nonce from response header", () => {
    const response = new Response(null, {
      headers: { "dpop-nonce": "abc123" },
    });
    expect(extractDpopNonce(response)).toBe("abc123");
  });

  it("returns undefined when no DPoP nonce header", () => {
    const response = new Response(null);
    expect(extractDpopNonce(response)).toBeUndefined();
  });
});
