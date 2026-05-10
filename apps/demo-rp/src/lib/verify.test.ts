import { beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => ({
  calculateJwkThumbprint: vi.fn(),
  importJWK: vi.fn(),
  jwtVerify: vi.fn(),
}));

const rpMocks = vi.hoisted(() => {
  const verify = vi.fn();
  return {
    createJwksTokenVerifier: vi.fn(() => ({ verify })),
    verify,
  };
});

vi.mock("jose", () => joseMocks);
vi.mock("@zentity/sdk/rp", () => ({
  createJwksTokenVerifier: rpMocks.createJwksTokenVerifier,
}));
vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    ZENTITY_URL: "http://zentity-internal:3000",
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz",
  },
}));

import { verifyVpToken } from "./verify";

const HOLDER_JWK = {
  crv: "Ed25519",
  kty: "OKP",
  x: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
} as const;
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
    joseMocks.importJWK.mockReset();
    joseMocks.jwtVerify.mockReset();
    rpMocks.createJwksTokenVerifier.mockClear();
    rpMocks.verify.mockReset();
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
    rpMocks.verify.mockResolvedValueOnce({
      payload: { cnf: { jkt: HOLDER_THUMBPRINT, jwk: HOLDER_JWK } },
    });
    joseMocks.jwtVerify.mockResolvedValueOnce({
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

  it("rejects duplicate disclosure claim names", async () => {
    rpMocks.verify.mockResolvedValueOnce({
      payload: { cnf: { jkt: HOLDER_THUMBPRINT, jwk: HOLDER_JWK } },
    });

    const vpToken = [
      "issuer-jwt",
      disclosure("name", "Alice"),
      disclosure("name", "Mallory"),
      "kb-jwt",
    ].join("~");

    const result = await verifyVpToken(
      vpToken,
      "expected-nonce",
      "https://rp.example"
    );

    expect(result).toEqual({ verified: false, claims: {} });
    expect(joseMocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("rejects disclosures with duplicate JSON keys", async () => {
    rpMocks.verify.mockResolvedValueOnce({
      payload: { cnf: { jkt: HOLDER_THUMBPRINT, jwk: HOLDER_JWK } },
    });

    const duplicateJsonDisclosure = base64url(
      '["salt","address",{"country":"US","country":"CA"}]'
    );
    const vpToken = `issuer-jwt~${duplicateJsonDisclosure}~kb-jwt`;

    const result = await verifyVpToken(
      vpToken,
      "expected-nonce",
      "https://rp.example"
    );

    expect(result).toEqual({ verified: false, claims: {} });
    expect(joseMocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("rejects duplicate KB-JWT header keys before importing holder keys", async () => {
    rpMocks.verify.mockResolvedValueOnce({
      payload: { cnf: { jkt: HOLDER_THUMBPRINT } },
    });
    const kbJwt = `${base64url(
      `{"jwk":{"kty":"OKP"},"jwk":${JSON.stringify(HOLDER_JWK)}}`
    )}.payload.signature`;
    const vpToken = `issuer-jwt~${disclosure("name", "Alice")}~${kbJwt}`;

    const result = await verifyVpToken(
      vpToken,
      "expected-nonce",
      "https://rp.example"
    );

    expect(result).toEqual({
      verified: false,
      claims: { name: "Alice" },
    });
    expect(joseMocks.importJWK).not.toHaveBeenCalled();
  });
});
