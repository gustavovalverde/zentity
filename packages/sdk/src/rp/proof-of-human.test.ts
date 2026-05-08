import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifierMocks = vi.hoisted(() => ({
  createJwksTokenVerifier: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("./token-verifier", () => ({
  createJwksTokenVerifier: verifierMocks.createJwksTokenVerifier,
}));

import {
  createProofOfHumanTokenVerifier,
  requestProofOfHumanToken,
} from "./proof-of-human";

function createJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url"
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

const verifiedDocumentaryFullPoh = {
  identity: {
    verified: true,
    strength: "documentary_full",
  },
  humanity: { proven: false },
  policy: { version: "v1.0" },
};

const humanityOnlyPoh = {
  identity: { verified: false, strength: "none" },
  humanity: { proven: true },
  policy: { version: "v1.0" },
};

describe("createProofOfHumanTokenVerifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifierMocks.createJwksTokenVerifier.mockReturnValue({
      verify: verifierMocks.verify,
    });
  });

  it("verifies proof-of-human tokens and normalizes their orthogonal axes", async () => {
    verifierMocks.verify.mockResolvedValue({
      payload: {
        cnf: { jkt: "thumbprint-1" },
        exp: 1_800_000_000,
        poh: verifiedDocumentaryFullPoh,
        sub: "pairwise-sub",
      },
    });

    const verifier = createProofOfHumanTokenVerifier({
      issuer: "https://issuer.example",
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).resolves.toEqual({
      cnf: { jkt: "thumbprint-1" },
      exp: 1_800_000_000,
      poh: verifiedDocumentaryFullPoh,
      sub: "pairwise-sub",
    });
    expect(verifierMocks.verify).toHaveBeenCalledWith("poh-token", {
      algorithms: ["EdDSA"],
    });
  });

  it("rejects proof-of-human tokens missing required axis flags", async () => {
    verifierMocks.verify.mockResolvedValue({
      payload: {
        exp: 1_800_000_000,
        poh: { policy: { version: "v1.0" } },
        sub: "pairwise-sub",
      },
    });

    const verifier = createProofOfHumanTokenVerifier({
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).rejects.toThrow(
      "Proof-of-human token missing required axis flags"
    );
  });

  it("accepts humanity-only tokens (verified=false, proven=true)", async () => {
    verifierMocks.verify.mockResolvedValue({
      payload: {
        cnf: { jkt: "thumbprint-1" },
        exp: 1_800_000_000,
        poh: humanityOnlyPoh,
        sub: "pairwise-sub",
      },
    });

    const verifier = createProofOfHumanTokenVerifier({
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).resolves.toMatchObject({
      poh: humanityOnlyPoh,
    });
  });
});

describe("requestProofOfHumanToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a proof-of-human token with DPoP and normalizes the response", async () => {
    const token = createJwt({
      cnf: { jkt: "thumbprint-1" },
      poh: verifiedDocumentaryFullPoh,
    });
    const proofFor = vi.fn(async () => "dpop-proof");
    const withNonceRetry = async <T,>(
      attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
    ) => attempt("nonce-1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    const result = await requestProofOfHumanToken({
      accessToken: "access-token",
      dpopClient: { proofFor, withNonceRetry },
      proofOfHumanUrl: "https://issuer.example/proof-of-human",
    });

    expect(proofFor).toHaveBeenCalledWith(
      "POST",
      "https://issuer.example/proof-of-human",
      "access-token",
      "nonce-1"
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://issuer.example/proof-of-human",
      {
        method: "POST",
        headers: {
          Authorization: "DPoP access-token",
          DPoP: "dpop-proof",
        },
      }
    );
    expect(result).toEqual({
      ok: true,
      token,
      confirmationJkt: "thumbprint-1",
      unverifiedClaims: verifiedDocumentaryFullPoh,
    });
  });

  it("returns issuer errors when the proof-of-human request fails", async () => {
    const proofFor = vi.fn(async () => "dpop-proof");
    const withNonceRetry = async <T,>(
      attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
    ) => attempt();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "access_denied",
          error_description: "Token expired",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 401,
        }
      )
    );

    const result = await requestProofOfHumanToken({
      accessToken: "access-token",
      dpopClient: { proofFor, withNonceRetry },
      proofOfHumanUrl: "https://issuer.example/proof-of-human",
    });

    expect(result).toEqual({
      ok: false,
      error: "access_denied",
      errorDescription: "Token expired",
      status: 401,
    });
  });
});
