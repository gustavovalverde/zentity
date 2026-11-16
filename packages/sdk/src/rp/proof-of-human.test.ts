import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifierMocks = vi.hoisted(() => ({
  createJwksTokenVerifier: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("./token-verifier", () => ({
  createJwksTokenVerifier: verifierMocks.createJwksTokenVerifier,
}));

import { calculateJwkThumbprint, SignJWT } from "jose";
import {
  fixtureKeys,
  getFixtureEd25519PrivateKey,
} from "../testing/fixture-keys";
import { mockMerchantPohToken } from "../testing/mock-poh-token";
import {
  createDpopClient,
  type DpopClient,
  type DpopRequestInit,
} from "./dpop-client";
import {
  assertApprovedRequirement,
  assertIdentityStrength,
  createInMemoryProofOfHumanReplayStore,
  createProofOfHumanTokenVerifier,
  type ProofOfHumanReplayStore,
  recordProofOfHumanUse,
  requestProofOfHumanToken,
  verifyProofOfHumanPresentation,
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

  const CLAIMS = {
    aud: "client-1",
    cnf: { jkt: "thumbprint-1" },
    exp: 1_800_000_000,
    iat: 1_799_999_700,
    jti: "jti-1",
    sub: "pairwise-sub",
  };

  it("verifies a client-mode token for its audience, type, and key", async () => {
    verifierMocks.verify.mockResolvedValue({
      payload: { ...CLAIMS, poh: verifiedDocumentaryFullPoh },
    });

    const verifier = createProofOfHumanTokenVerifier({
      audience: "client-1",
      issuer: "https://issuer.example",
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).resolves.toEqual({
      ...CLAIMS,
      poh: verifiedDocumentaryFullPoh,
    });
    expect(verifierMocks.verify).toHaveBeenCalledWith("poh-token", {
      algorithms: ["EdDSA"],
      audience: "client-1",
      typ: "poh+jwt",
    });
  });

  it.each(["jti", "cnf", "aud"])(
    "refuses a token without %s",
    async (claim) => {
      const payload: Record<string, unknown> = {
        ...CLAIMS,
        poh: verifiedDocumentaryFullPoh,
      };
      delete payload[claim];
      verifierMocks.verify.mockResolvedValue({ payload });

      const verifier = createProofOfHumanTokenVerifier({
        audience: "client-1",
        jwksUrl: "https://issuer.example/jwks",
      });

      await expect(verifier.verify("poh-token")).rejects.toThrow(
        "Proof-of-human token missing"
      );
    }
  );

  it("rejects proof-of-human tokens missing required axis flags", async () => {
    verifierMocks.verify.mockResolvedValue({
      payload: { ...CLAIMS, poh: { policy: { version: "v1.0" } } },
    });

    const verifier = createProofOfHumanTokenVerifier({
      audience: "client-1",
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).rejects.toThrow(
      "Proof-of-human token missing required axis flags"
    );
  });

  it("accepts humanity-only tokens (verified=false, proven=true)", async () => {
    verifierMocks.verify.mockResolvedValue({
      payload: { ...CLAIMS, poh: humanityOnlyPoh },
    });

    const verifier = createProofOfHumanTokenVerifier({
      audience: "client-1",
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).resolves.toMatchObject({
      poh: humanityOnlyPoh,
    });
  });

  it("reads a merchant-mode predicate", async () => {
    const predicate = {
      identity: { strength_at_least: "documentary_full" },
      policy: { version: "v1.0" },
    };
    verifierMocks.verify.mockResolvedValue({
      payload: { ...CLAIMS, poh: predicate },
    });

    const verifier = createProofOfHumanTokenVerifier({
      audience: "client-1",
      jwksUrl: "https://issuer.example/jwks",
    });

    await expect(verifier.verify("poh-token")).resolves.toMatchObject({
      poh: predicate,
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
    const dpopFetch = vi.fn(
      async (_url: string | URL, _init?: DpopRequestInit) =>
        new Response(JSON.stringify({ token }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
    );

    const result = await requestProofOfHumanToken({
      accessToken: "access-token",
      dpopClient: { fetch: dpopFetch },
      proofOfHumanUrl: "https://issuer.example/proof-of-human",
    });

    expect(dpopFetch).toHaveBeenCalledWith(
      "https://issuer.example/proof-of-human",
      { method: "POST", accessToken: "access-token" }
    );
    expect(result).toEqual({
      ok: true,
      token,
      confirmationJkt: "thumbprint-1",
      expiresIn: null,
      unverifiedClaims: verifiedDocumentaryFullPoh,
    });
  });

  it("returns issuer errors when the proof-of-human request fails", async () => {
    const dpopFetch = vi.fn(
      async () =>
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
      dpopClient: { fetch: dpopFetch },
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

describe("merchant presentation", () => {
  const ISSUER = "https://mock-issuer.zentity.test";
  const MERCHANT = "https://merchant.example";
  const RESOURCE_URL = `${MERCHANT}/api/x402/access?resourceId=verified-identity`;
  const JWKS = { keys: [fixtureKeys.ed25519.publicJwk] };
  const REQUIREMENT = {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  };
  const APPROVED = {
    type: "x402_purchase",
    resource_url: RESOURCE_URL,
    payment_requirements: REQUIREMENT,
    min_identity_strength: "documentary",
  };

  let purchaseKey: DpopClient;
  let replayStore: ProofOfHumanReplayStore;

  async function merchantToken(overrides: { merchant?: string } = {}) {
    return mockMerchantPohToken({
      authorizationDetails: [APPROVED],
      confirmationJkt: await calculateJwkThumbprint(
        purchaseKey.keyPair.publicJwk,
        "sha256"
      ),
      issuer: ISSUER,
      merchant: overrides.merchant ?? MERCHANT,
      strengthAtLeast: "documentary",
      subject: "user-pairwise",
    });
  }

  async function presented(
    token: string,
    proof?: string | null,
    scheme = "DPoP"
  ): Promise<Request> {
    const headers = new Headers({ authorization: `${scheme} ${token}` });
    const dpop =
      proof === undefined
        ? await purchaseKey.proofFor("GET", RESOURCE_URL, token)
        : proof;
    if (dpop) {
      headers.set("dpop", dpop);
    }
    return new Request(RESOURCE_URL, { headers });
  }

  function verify(request: Request) {
    return verifyProofOfHumanPresentation({
      audience: MERCHANT,
      issuer: ISSUER,
      jwks: JWKS,
      replayStore,
      request,
    });
  }

  async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason
    );
    return {
      code: (error as { code?: string } | null)?.code,
      status: (error as { status?: number } | null)?.status,
    };
  }

  beforeEach(async () => {
    purchaseKey = await createDpopClient();
    replayStore = createInMemoryProofOfHumanReplayStore();
  });

  it("accepts a token presented with a proof by its key, without spending it", async () => {
    const token = await merchantToken();

    const claims = await verify(await presented(token));

    expect(claims.aud).toBe(MERCHANT);
    expect(await replayStore.has(`poh:${claims.jti}`)).toBe(false);
  });

  // R13: comparing the thumbprint alone is not sender binding.
  it.each([
    ["a missing proof", async (token: string) => presented(token, null)],
    [
      "a proof for another token",
      async (token: string) =>
        presented(
          token,
          await purchaseKey.proofFor("GET", RESOURCE_URL, "another-token")
        ),
    ],
    [
      "a proof by another key",
      async (token: string) =>
        presented(
          token,
          await (await createDpopClient()).proofFor("GET", RESOURCE_URL, token)
        ),
    ],
    [
      "a proof for another method",
      async (token: string) =>
        presented(token, await purchaseKey.proofFor("POST", RESOURCE_URL, token)),
    ],
  ])("refuses %s with 401", async (_case, build) => {
    const token = await merchantToken();

    expect(await refusal(verify(await build(token)))).toEqual({
      code: "invalid_dpop_proof",
      status: 401,
    });
  });

  it("refuses a replayed proof", async () => {
    const token = await merchantToken();
    const request = await presented(token);
    await verify(request.clone());

    expect((await refusal(verify(request))).status).toBe(401);
  });

  it("refuses a token already used for a payment", async () => {
    const token = await merchantToken();
    const claims = await verify(await presented(token));
    await recordProofOfHumanUse(claims, replayStore);

    expect(await refusal(verify(await presented(token)))).toEqual({
      code: "invalid_token",
      status: 401,
    });
    await expect(recordProofOfHumanUse(claims, replayStore)).rejects.toThrow(
      "already used"
    );
  });

  it.each([
    ["another merchant's token", () => merchantToken({ merchant: "https://other.example" })],
    [
      "an untyped token",
      async () =>
        new SignJWT({ poh: {}, cnf: { jkt: "x" } })
          .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
          .setIssuer(ISSUER)
          .setAudience(MERCHANT)
          .setSubject("user")
          .setJti("jti")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(await getFixtureEd25519PrivateKey()),
    ],
  ])("refuses %s with invalid_token", async (_case, mint) => {
    const token = await mint();

    expect(await refusal(verify(await presented(token)))).toEqual({
      code: "invalid_token",
      status: 401,
    });
  });

  it("refuses a bearer presentation", async () => {
    const token = await merchantToken();

    expect((await refusal(verify(await presented(token, undefined, "Bearer")))).code).toBe(
      "invalid_token"
    );
  });

  it("compares the approved terms with the route and the payment", async () => {
    const claims = await verify(await presented(await merchantToken()));
    const reordered = Object.fromEntries(Object.entries(REQUIREMENT).reverse());

    expect(() =>
      assertApprovedRequirement(
        claims,
        reordered,
        { accepted: REQUIREMENT },
        RESOURCE_URL
      )
    ).not.toThrow();
    for (const [route, accepted, url] of [
      [{ ...REQUIREMENT, amount: "2" }, REQUIREMENT, RESOURCE_URL],
      [REQUIREMENT, { ...REQUIREMENT, payTo: "0x1" }, RESOURCE_URL],
      [REQUIREMENT, REQUIREMENT, `${MERCHANT}/other`],
    ] as const) {
      expect(() =>
        assertApprovedRequirement(claims, route, { accepted }, url)
      ).toThrow(expect.objectContaining({ code: "approval_mismatch" }));
    }
  });

  it("checks the stated strength against the merchant's minimum", async () => {
    const claims = await verify(await presented(await merchantToken()));

    expect(() => assertIdentityStrength(claims, "documentary")).not.toThrow();
    expect(() => assertIdentityStrength(claims, "documentary_full")).toThrow(
      expect.objectContaining({
        code: "insufficient_identity_strength",
        status: 403,
      })
    );
  });
});
