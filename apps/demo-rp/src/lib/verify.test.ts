import { beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => ({
  calculateJwkThumbprint: vi.fn(),
  createRemoteJWKSet: vi.fn(() => "jwks"),
  importJWK: vi.fn(),
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => joseMocks);
vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    ZENTITY_URL: "http://zentity-internal:3000",
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz",
  },
}));

import { verifyVpToken } from "./verify";

const HOLDER_JWK = { crv: "Ed25519", kty: "OKP", x: "holder-x" } as const;
const HOLDER_THUMBPRINT = "holder-thumbprint";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function disclosure(name: string, value: unknown): string {
  return base64url(JSON.stringify(["salt", name, value]));
}

describe("verifyVpToken", () => {
  beforeEach(() => {
    joseMocks.calculateJwkThumbprint.mockReset();
    joseMocks.createRemoteJWKSet.mockReset().mockReturnValue("jwks");
    joseMocks.importJWK.mockReset();
    joseMocks.jwtVerify.mockReset();
  });

  it("rejects VP tokens with an empty trailing KB-JWT segment", async () => {
    joseMocks.jwtVerify.mockResolvedValueOnce({
      payload: { cnf: { jkt: HOLDER_THUMBPRINT } },
    });

    const vpToken = `issuer-jwt~${disclosure("name", "Alice")}~`;

    const result = await verifyVpToken(
      vpToken,
      "expected-nonce",
      "https://rp.example"
    );

    expect(result.verified).toBe(false);
  });

  it("accepts VP tokens with a valid KB-JWT", async () => {
    joseMocks.jwtVerify
      .mockResolvedValueOnce({
        payload: { cnf: { jkt: HOLDER_THUMBPRINT, jwk: HOLDER_JWK } },
      })
      .mockResolvedValueOnce({
        payload: { nonce: "expected-nonce" },
      });
    joseMocks.calculateJwkThumbprint.mockResolvedValueOnce(HOLDER_THUMBPRINT);
    joseMocks.importJWK.mockResolvedValueOnce("holder-key");

    const vpToken = `issuer-jwt~${disclosure("name", "Alice")}~kb-jwt`;

    const result = await verifyVpToken(
      vpToken,
      "expected-nonce",
      "https://rp.example"
    );

    expect(result).toEqual({
      verified: true,
      claims: { name: "Alice" },
    });
  });
});
