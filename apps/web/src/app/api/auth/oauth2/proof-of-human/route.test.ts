import type { UnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  signJwt: vi.fn(),
  getUnifiedVerificationModel: vi.fn(),
  resolveUserIdFromSub: vi.fn(),
}));

vi.mock("@/lib/trpc/jwt-session", () => ({
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock("@/lib/auth/oidc/jwt-signer", () => ({
  signJwt: mocks.signJwt,
}));

vi.mock("@/lib/identity/verification/unified-model", () => ({
  getUnifiedVerificationModel: mocks.getUnifiedVerificationModel,
}));

vi.mock("@/lib/auth/oidc/pairwise", () => ({
  resolveUserIdFromSub: mocks.resolveUserIdFromSub,
}));

import { POST } from "./route";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/oauth2/proof-of-human", {
    method: "POST",
    headers,
  });
}

function makeAccessTokenPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: "pairwise-sub-for-client-a",
    client_id: "client-a",
    scope: "openid poh",
    iss: "http://localhost:3000/api/auth",
    aud: "http://localhost:3000",
    ...overrides,
  };
}

function makeVerifiedModel(
  overrides: Partial<UnifiedVerificationModel> = {}
): UnifiedVerificationModel {
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
    bundle: {
      exists: true,
      fheKeyId: "fhe-1",
      policyVersion: null,
      attestationExpiresAt: null,
      updatedAt: null,
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
  mocks.getUnifiedVerificationModel.mockResolvedValue(makeVerifiedModel());
  mocks.signJwt.mockResolvedValue("signed-poh-jwt");
}

describe("POST /api/auth/oauth2/proof-of-human", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a PoH JWT with correct claims for a verified user", async () => {
    setupVerifiedUser();

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body.token).toBe("signed-poh-jwt");

    // Verify signJwt was called with the correct PoH payload
    expect(mocks.signJwt).toHaveBeenCalledOnce();
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.iss).toBe("http://localhost:3000");
    expect(payload.sub).toBe("pairwise-sub-for-client-a");
    expect(payload.scope).toBe("poh");
    expect(payload.poh).toEqual({
      tier: 3,
      verified: true,
      sybil_resistant: true,
      method: "ocr",
    });
    expect(payload.exp).toBeGreaterThan(payload.iat as number);

    // Cache-Control: no-store
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

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 403 insufficient_scope when poh scope is missing", async () => {
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({ scope: "openid email" })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("insufficient_scope");
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("includes cnf.jkt in PoH JWT when access token is DPoP-bound", async () => {
    const dpopThumbprint = "sha256-dpop-key-thumbprint";
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({ cnf: { jkt: dpopThumbprint } })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getUnifiedVerificationModel.mockResolvedValue(makeVerifiedModel());
    mocks.signJwt.mockResolvedValue("signed-poh-jwt");

    const response = await POST(
      makeRequest({ authorization: "DPoP eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.cnf).toEqual({ jkt: dpopThumbprint });
  });

  it("omits cnf when access token has no DPoP binding", async () => {
    setupVerifiedUser();

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.cnf).toBeUndefined();
  });

  it("uses pairwise sub from the access token — different clients get different subs", async () => {
    // Client A
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({
        sub: "pairwise-sub-client-a",
        client_id: "client-a",
      })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getUnifiedVerificationModel.mockResolvedValue(makeVerifiedModel());
    mocks.signJwt.mockResolvedValue("jwt-a");

    await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    const subA = (mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>)
      .sub;

    // Client B
    vi.clearAllMocks();
    mocks.verifyAccessToken.mockResolvedValue(
      makeAccessTokenPayload({
        sub: "pairwise-sub-client-b",
        client_id: "client-b",
      })
    );
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getUnifiedVerificationModel.mockResolvedValue(makeVerifiedModel());
    mocks.signJwt.mockResolvedValue("jwt-b");

    await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    const subB = (mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>)
      .sub;

    // Same user, different clients → different pairwise subs in PoH tokens
    expect(subA).toBe("pairwise-sub-client-a");
    expect(subB).toBe("pairwise-sub-client-b");
    expect(subA).not.toBe(subB);
  });

  it("returns 403 not_verified for unverified users", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue("user-456");
    mocks.getUnifiedVerificationModel.mockResolvedValue(
      makeVerifiedModel({ verificationId: null })
    );

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_verified");
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });

  it("reflects the correct tier for a basic-level user", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getUnifiedVerificationModel.mockResolvedValue(
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

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.poh).toEqual({
      tier: 2,
      verified: false,
      sybil_resistant: false,
      method: "ocr",
    });
  });

  it("reflects NFC chip method in the PoH token", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue("user-123");
    mocks.getUnifiedVerificationModel.mockResolvedValue(
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

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(200);
    const payload = mocks.signJwt.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.poh).toEqual({
      tier: 4,
      verified: true,
      sybil_resistant: true,
      method: "nfc_chip",
    });
  });

  it("returns 401 when access token has no client_id or azp", async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      sub: "user-sub",
      scope: "openid poh",
      // no client_id, no azp
    });

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("returns 401 when resolveUserIdFromSub returns null", async () => {
    mocks.verifyAccessToken.mockResolvedValue(makeAccessTokenPayload());
    mocks.resolveUserIdFromSub.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.test.sig" })
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });
});
