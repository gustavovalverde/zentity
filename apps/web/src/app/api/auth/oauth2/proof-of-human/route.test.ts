import type { VerificationReadModel } from "@/lib/identity/verification/read-model";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signJwt: vi.fn(),
  getVerificationReadModel: vi.fn(),
  resolveSubForClientId: vi.fn(),
  loadOpaqueAccessToken: vi.fn(),
  validateOpaqueAccessTokenDpop: vi.fn(),
}));

vi.mock("@/lib/auth/oidc/jwt-signer", () => ({
  signJwt: mocks.signJwt,
}));

vi.mock("@/lib/identity/verification/read-model", () => ({
  getVerificationReadModel: mocks.getVerificationReadModel,
}));

vi.mock("@/lib/auth/oidc/pairwise", () => ({
  resolveSubForClientId: mocks.resolveSubForClientId,
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
    authorization: "DPoP opaque-access-token",
    dpop: "test-dpop-proof",
    ...headers,
  });
}

function makeStoredToken(overrides: Record<string, unknown> = {}) {
  return {
    authContextId: null,
    clientId: "client-a",
    dpopJkt: TEST_DPOP_JKT,
    exchangeClaims: {},
    expiresAt: new Date(Date.now() + 60_000),
    referenceId: null,
    scopes: ["openid", "poh"],
    sessionId: null,
    userId: "user-123",
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
      identity: {
        verified: true,
        method: "ocr",
        strength: "documentary_full",
      },
      humanity: {
        proven: false,
      },
      policy: {
        version: "v1.0",
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
    humanityCredentials: [],
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
  mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());
  mocks.resolveSubForClientId.mockResolvedValue("pairwise-sub-for-client-a");
  mocks.getVerificationReadModel.mockResolvedValue(makeVerifiedModel());
  mocks.signJwt.mockResolvedValue("signed-poh-jwt");
}

describe("POST /api/auth/oauth2/proof-of-human", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateOpaqueAccessTokenDpop.mockResolvedValue(true);
  });

  it("returns a PoH JWT with orthogonal axes for a verified user", async () => {
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
      identity: {
        verified: true,
        strength: "documentary_full",
      },
      humanity: { proven: false },
      policy: { version: "v1.0" },
    });
    // `method` is intentionally NOT in the PoH JWT — forwarding OCR vs NFC
    // would let RPs discriminate by verification path.
    expect(
      (payload.poh as Record<string, unknown>).identity
    ).not.toHaveProperty("method");
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
    mocks.loadOpaqueAccessToken.mockResolvedValue(null);

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 403 insufficient_scope when poh scope is missing", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(
      makeStoredToken({ scopes: ["openid", "email"] })
    );
    mocks.resolveSubForClientId.mockResolvedValue("pairwise-sub-for-client-a");

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("insufficient_scope");
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("rejects access tokens that lack a DPoP binding", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(
      makeStoredToken({ dpopJkt: null })
    );

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    expect(mocks.signJwt).not.toHaveBeenCalled();
    expect(mocks.validateOpaqueAccessTokenDpop).not.toHaveBeenCalled();
  });

  it("returns 403 not_verified when neither identity nor humanity is present", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());
    mocks.resolveSubForClientId.mockResolvedValue("pairwise-sub-for-client-a");
    mocks.getVerificationReadModel.mockResolvedValue(
      makeVerifiedModel({
        verificationId: null,
        compliance: {
          identity: { verified: false, method: null, strength: "none" },
          humanity: { proven: false },
          policy: {
            version: "v1.0",
            birthYearOffset: null,
            checks: {
              documentVerified: false,
              livenessVerified: false,
              ageVerified: false,
              faceMatchVerified: false,
              nationalityVerified: false,
              identityBound: false,
              sybilResistant: false,
            },
          },
        },
      })
    );

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_verified");
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("issues a humanity-only token (identity.verified=false, humanity.proven=true)", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());
    mocks.resolveSubForClientId.mockResolvedValue("pairwise-sub-for-client-a");
    mocks.getVerificationReadModel.mockResolvedValue(
      makeVerifiedModel({
        verificationId: null,
        method: null,
        compliance: {
          identity: { verified: false, method: null, strength: "none" },
          humanity: { proven: true },
          policy: {
            version: "v1.0",
            birthYearOffset: null,
            checks: {
              documentVerified: false,
              livenessVerified: false,
              ageVerified: false,
              faceMatchVerified: false,
              nationalityVerified: false,
              identityBound: false,
              sybilResistant: true,
            },
          },
        },
      })
    );
    mocks.signJwt.mockResolvedValue("signed-poh-jwt");

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.poh).toEqual({
      identity: { verified: false, strength: "none" },
      humanity: { proven: true },
      policy: { version: "v1.0" },
    });
  });

  it("issues a cryptographic_chip-strength token without leaking the method", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());
    mocks.resolveSubForClientId.mockResolvedValue("pairwise-sub-for-client-a");
    mocks.getVerificationReadModel.mockResolvedValue(
      makeVerifiedModel({
        method: "nfc_chip",
        compliance: {
          identity: {
            verified: true,
            method: "nfc_chip",
            strength: "cryptographic_chip",
          },
          humanity: { proven: false },
          policy: {
            version: "v1.0",
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
        },
      })
    );
    mocks.signJwt.mockResolvedValue("signed-poh-jwt");

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.poh).toEqual({
      identity: {
        verified: true,
        strength: "cryptographic_chip",
      },
      humanity: { proven: false },
      policy: { version: "v1.0" },
    });
    expect(
      (payload.poh as Record<string, unknown>).identity
    ).not.toHaveProperty("method");
  });

  it("rejects DPoP-bound JWT access tokens sent with Bearer authorization", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());

    const response = await POST(
      makeRequest({ authorization: "Bearer opaque-access-token" })
    );

    expect(response.status).toBe(401);
    expect(mocks.signJwt).not.toHaveBeenCalled();
    expect(mocks.validateOpaqueAccessTokenDpop).not.toHaveBeenCalled();
  });

  it("rejects requests when DPoP proof validation fails", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());
    mocks.validateOpaqueAccessTokenDpop.mockResolvedValue(false);

    const response = await POST(makeDpopRequest({ dpop: "bad-proof" }));

    expect(response.status).toBe(401);
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("projects the client's pairwise sub; different clients get different subs", async () => {
    mocks.resolveSubForClientId.mockImplementation(
      (userId: string, clientId: string) =>
        Promise.resolve(`pairwise-${clientId}-${userId}`)
    );
    mocks.getVerificationReadModel.mockResolvedValue(makeVerifiedModel());
    mocks.signJwt.mockResolvedValue("jwt");

    mocks.loadOpaqueAccessToken.mockResolvedValue(
      makeStoredToken({ clientId: "client-a" })
    );
    await POST(makeDpopRequest());
    mocks.loadOpaqueAccessToken.mockResolvedValue(
      makeStoredToken({ clientId: "client-b" })
    );
    await POST(makeDpopRequest());

    const [subA, subB] = mocks.signJwt.mock.calls.map(
      (call) => (call[0] as Record<string, unknown>).sub
    );
    expect(subA).toBe("pairwise-client-a-user-123");
    expect(subB).toBe("pairwise-client-b-user-123");
    expect(mocks.getVerificationReadModel).toHaveBeenCalledWith("user-123");
  });

  it("returns 401 when the access token has expired", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(
      makeStoredToken({ expiresAt: new Date(Date.now() - 1000) })
    );

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 401 when the token's client is unknown", async () => {
    mocks.loadOpaqueAccessToken.mockResolvedValue(makeStoredToken());
    mocks.resolveSubForClientId.mockResolvedValue(null);

    const response = await POST(makeDpopRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });
});
