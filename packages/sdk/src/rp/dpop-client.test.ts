import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => {
  class MockSignJWT {
    claims: Record<string, unknown>;
    header: Record<string, unknown> | undefined;

    constructor(claims: Record<string, unknown>) {
      this.claims = { ...claims };
    }

    setIssuedAt() {
      return this;
    }

    setProtectedHeader(header: Record<string, unknown>) {
      this.header = header;
      return this;
    }

    async sign() {
      return JSON.stringify({
        claims: this.claims,
        header: this.header,
      });
    }
  }

  return {
    exportJWK: vi.fn(async (key: unknown) =>
      key === "private-key"
        ? { crv: "P-256", d: "private", kty: "EC", x: "pub-x", y: "pub-y" }
        : { crv: "P-256", kty: "EC", x: "pub-x", y: "pub-y" }
    ),
    generateKeyPair: vi.fn(async () => ({
      privateKey: "private-key",
      publicKey: "public-key",
    })),
    importJWK: vi.fn(async () => "imported-private-key"),
    SignJWT: MockSignJWT,
  };
});

vi.mock("jose", () => joseMocks);

import {
  createDpopClient,
  createDpopClientFromKeyPair,
  generateDpopKeyPair,
} from "./dpop-client";

describe("dpop client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "nonce-id"),
      subtle: {
        digest: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generates a serialized ES256 key pair", async () => {
    const keyPair = await generateDpopKeyPair();

    expect(keyPair).toEqual({
      privateJwk: {
        crv: "P-256",
        d: "private",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
      publicJwk: {
        crv: "P-256",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
    });
    expect(joseMocks.generateKeyPair).toHaveBeenCalledWith("ES256", {
      extractable: true,
    });
  });

  it("builds DPoP proofs from a persisted key pair", async () => {
    const client = await createDpopClientFromKeyPair({
      privateJwk: {
        crv: "P-256",
        d: "private",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
      publicJwk: { crv: "P-256", kty: "EC", x: "pub-x", y: "pub-y" },
    });

    const proof = await client.proofFor(
      "GET",
      "https://issuer.example/userinfo",
      "access-token",
      "retry-nonce"
    );

    expect(proof).toContain("\"htu\":\"https://issuer.example/userinfo\"");
    expect(proof).toContain("\"htm\":\"GET\"");
    expect(proof).toContain("\"nonce\":\"retry-nonce\"");
    expect(proof).toContain("\"jti\":\"nonce-id\"");
    expect(proof).toContain("\"typ\":\"dpop+jwt\"");
  });

  it("retries once when a DPoP nonce challenge is returned", async () => {
    const client = await createDpopClient();
    const attempt = vi
      .fn<(nonce?: string) => Promise<{ response: Response; result: string }>>()
      .mockResolvedValueOnce({
        response: new Response("", {
          headers: { "DPoP-Nonce": "next-nonce" },
          status: 401,
        }),
        result: "first",
      })
      .mockResolvedValueOnce({
        response: new Response("", { status: 200 }),
        result: "second",
      });

    const result = await client.withNonceRetry(attempt);

    expect(attempt).toHaveBeenNthCalledWith(1);
    expect(attempt).toHaveBeenNthCalledWith(2, "next-nonce");
    expect(result.result).toBe("second");
  });
});
