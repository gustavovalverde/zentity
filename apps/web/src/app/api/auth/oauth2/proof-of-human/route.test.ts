import type { VerificationReadModel } from "@/lib/identity/verification/read-model";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  signJwt: vi.fn(),
  getVerificationReadModel: vi.fn(),
  resolveUserIdFromSub: vi.fn(),
  loadOpaqueAccessToken: vi.fn(),
  validateOpaqueAccessTokenDpop: vi.fn(),
}));

vi.mock("@/lib/auth/jwt", () => ({
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock("@/lib/auth/oidc/jwt-signer", () => ({
  signJwt: mocks.signJwt,
}));

vi.mock("@/lib/identity/verification/read-model", () => ({
  getVerificationReadModel: mocks.getVerificationReadModel,
}));

vi.mock("@/lib/auth/oidc/pairwise", () => ({
  resolveUserIdFromSub: mocks.resolveUserIdFromSub,
}));

vi.mock("@/lib/auth/oidc/haip/opaque-access-token", () => ({
  loadOpaqueAccessToken: mocks.loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop: mocks.validateOpaqueAccessTokenDpop,
}));

import { POST } from "./route";

const TEST_DPOP_JKT = "sha256-dpop-key-thumbprint";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/oauth2/proof-of-human", {
    method: "POST",
    headers,
  });
}

function makeDpopRequest(headers: Record<string, string> = {}): Request {
  return makeRequest({
    authorization: "DPoP eyJhbGciOiJFZERTQSJ9.test.sig",
    dpop: "test-dpop-proof",
    ...headers,
  });
}

function makeAccessTokenPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: "pairwise-sub-for-client-a",
    client_id: "client-a",
    scope: "openid poh",
    iss: "http://localhost:3000/api/auth",
    aud: "http://localhost:3000",
    cnf: { jkt: TEST_DPOP_JKT },
    ...overrides,
  };
}

function makeVerifiedModel(
  overrides: Partial<VerificationReadModel> = {}
): VerificationReadModel {
  return {
    verificationId: "v-123",
    method: "ocr",
    verifiedAt: "2026-01-01T00:00:00Z",
    issuerCountry: null,
    compliance: {
      level: "full",
      numericLevel: 3,
      verified: true,
      birthYearOffset: null,
      checks: {
        documentVerified: true,
        livenessVerified: true,
        ageVerified: true,
        faceMatchVerified: true,
        nationalityVerified: true,
        identityBound: true,
        sybilResistant: true,
      },
    },
    checks: [],
    proofs: [],
    groupedIdentity: {
      effectiveVerificationId: "v-123",
      credentials: [
        {
          credentialId: "v-123",
          method: "ocr",
          status: "verified",
          verifiedAt: "2026-01-01T00:00:00Z",
          isEffective: true,
        },
      ],
    },
    bundle: {
      exists: true,
      fheKeyId: "fhe-1",
      policyVersion: null,
      attestationExpiresAt: null,
      verificationExpiresAt: null,
      updatedAt: null,
      validityStatus: "verified",
    },
    fhe: { complete: true, attributeTypes: [] },
    vault: { hasProfileSecret: true },
    onChainAttested: false,
    needsDocumentReprocessing: false,
    ...overrides,
  };
}

function setupVerifiedUser() {
  mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
  mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
  mocks.getVerificationReadModel.mockResolvedValue(makeVerifiedModel());
  mocks.signJwt.mockResolvedValue("signed-poh-jwt");
}

describe("POST /api/auth/oauth2/proof-of-human", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateOpaqueAccessTokenDpop.mockResolvedValue(true);
  });

  it("returns a PoH JWT with correct claims for a verified user", async () => {
    setupVerifiedUser();

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body.token).toBe("signed-poh-jwt");

    expect(mocks.signJwt).toHaveBeenCalledOnce();
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.iss).toBe("http://localhost:3000");
    expect(payload.sub).toBe("pairwise-sub-for-client-a");
    expect(payload.scope).toBe("poh");
    expect(payload.cnf).toEqual({ jkt: TEST_DPOP_JKT });
    expect(payload.poh).toEqual({
      tier: 3,
      verified: true,
      sybil_resistant: true,
    });
    expect(payload.poh).not.toHaveProperty("method");
    expect(payload.exp).toBeGreaterThan(payload.iat as number);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 401 for missing authorization header", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 401 for malformed authorization header", async () => {
    const response = await POST(
      makeRequest({ authorization: "not-a-valid-header" })
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 401 when token verification fails", async () => {
    mocks.verifyAccessToken.mockResolvedValue(null);

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 403 insufficient_scope when poh scope is missing", async () => {
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({ scope: "openid email" })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("insufficient_scope");
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("rejects access tokens that lack a DPoP binding", async () => {
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({ cnf: undefined })
    );

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    expect(mocks.signJwt).not.toHaveBeenCalled();
    expect(mocks.validateOpaqueAccessTokenDpop).not.toHaveBeenCalled();
  });

  it("rejects DPoP-bound JWT access tokens sent with Bearer auth", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(401);
    expect(mocks.signJwt).not.toHaveBeenCalled();
    expect(mocks.validateOpaqueAccessTokenDpop).not.toHaveBeenCalled();
  });

  it("rejects DPoP-bound JWT access tokens when proof validation fails", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.validateOpaqueAccessTokenDpop.mockResolvedValue(false);

    const response = await POST(makeDpopRequest({ dpop: "bad-proof" }));

    expect(response.status).toBe(401);
    expect(mocks.signJwt).not.toHaveBeenCalled();
    expect(mocks.validateOpaqueAccessTokenDpop).toHaveBeenCalledOnce();
  });

  it("uses pairwise sub from the access token — different clients get different subs", async () => {
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({
        sub: "pairwise-sub-client-a",
        client_id: "client-a",
      })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getVerificationReadModel.mockResolvedValue(makeVerifiedModel());
    mocks.signJwt.mockResolvedValue("jwt-a");

    await POST(makeDpopRequest());
    const subA = (mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>)
      .sub;

    vi.clearAllMocks();
    mocks.validateOpaqueAccessTokenDpop.mockResolvedValue(true);
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({
        sub: "pairwise-sub-client-b",
        client_id: "client-b",
      })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getVerificationReadModel.mockResolvedValue(makeVerifiedModel());
    mocks.signJwt.mockResolvedValue("jwt-b");

    await POST(makeDpopRequest());
    const subB = (mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>)
      .sub;

    expect(subA).toBe("pairwise-sub-client-a");
    expect(subB).toBe("pairwise-sub-client-b");
    expect(subA).not.toBe(subB);
  });

  it("returns 403 not_verified for unverified users", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue("user-456");
    mocks.getVerificationReadModel.mockResolvedValue(
      makeVerifiedModel({ verificationId: null })
    );

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_verified");
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("reflects the correct tier for a basic-level user", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getVerificationReadModel.mockResolvedValue(
      makeVerifiedModel({
        method: "ocr",
        compliance: {
          level: "basic",
          numericLevel: 2,
          verified: false,
          birthYearOffset: null,
          checks: {
            documentVerified: true,
            livenessVerified: true,
            ageVerified: true,
            faceMatchVerified: true,
            nationalityVerified: false,
            identityBound: false,
            sybilResistant: false,
          },
        },
      })
    );
    mocks.signJwt.mockResolvedValue("signed-poh-jwt");

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.poh).toEqual({
      tier: 2,
      verified: false,
      sybil_resistant: false,
    });
    expect(payload.poh).not.toHaveProperty("method");
  });

  it("omits verification method even for NFC-based proof-of-human tokens", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getVerificationReadModel.mockResolvedValue(
      makeVerifiedModel({
        method: "nfc_chip",
        compliance: {
          level: "chip",
          numericLevel: 4,
          verified: true,
          birthYearOffset: null,
          checks: {
            documentVerified: true,
            livenessVerified: true,
            ageVerified: true,
            faceMatchVerified: true,
            nationalityVerified: true,
            identityBound: true,
            sybilResistant: true,
          },
        },
      })
    );
    mocks.signJwt.mockResolvedValue("signed-poh-jwt");

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.poh).toEqual({
      tier: 4,
      verified: true,
      sybil_resistant: true,
    });
    expect(payload.poh).not.toHaveProperty("method");
  });

  it("returns 401 when access token has no client_id or azp", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      sub: "user-sub",
      scope: "openid poh",
      cnf: { jkt: TEST_DPOP_JKT },
    });

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 401 when resolveUserIdFromSub returns null", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue(null);

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });
});
