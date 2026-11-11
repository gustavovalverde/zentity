import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRpValidityState: vi.fn(),
  resolveSubForClientId: vi.fn(),
  verifyResourceRequest: vi.fn(),
}));

// Token validation runs in the provider behind this server-only endpoint; its
// DPoP, expiry, and revocation rules are covered by the integration suite.
vi.mock("@/lib/auth/auth-config", () => ({
  auth: { api: { verifyResourceRequest: mocks.verifyResourceRequest } },
}));

vi.mock("@/lib/auth/oidc/pairwise", () => ({
  resolveSubForClientId: mocks.resolveSubForClientId,
}));

vi.mock("@/lib/identity/validity/rp-notice", () => ({
  getRpValidityState: mocks.getRpValidityState,
}));

import { GET } from "./route";

const RESOURCE_METADATA =
  'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/oauth2/validity", {
    method: "GET",
    headers,
  });
}

function verifiedToken(scopes: string[]) {
  return {
    format: "opaque",
    token: "opaque-access-token",
    payload: {
      active: true,
      sub: "user-1",
      client_id: "client-1",
      scope: scopes.join(" "),
      cnf: { jkt: "thumbprint-1" },
    },
  };
}

describe("GET /api/auth/oauth2/validity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSubForClientId.mockResolvedValue("pairwise-sub-1");
  });

  it("answers a missing token with a bearer challenge naming the resource metadata", async () => {
    mocks.verifyResourceRequest.mockRejectedValue(
      new APIError("UNAUTHORIZED", {
        error: "invalid_token",
        error_description: "access token required",
      })
    );

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer ${RESOURCE_METADATA}`
    );
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_token",
    });
  });

  it("names the error when a presented token is refused", async () => {
    mocks.verifyResourceRequest.mockRejectedValue(
      new APIError("UNAUTHORIZED", {
        error: "invalid_token",
        error_description: "Invalid access token",
      })
    );

    const response = await GET(
      makeRequest({ authorization: "Bearer expired-token" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer error="invalid_token", error_description="Invalid access token", ${RESOURCE_METADATA}`
    );
  });

  it("answers a refused token in the DPoP scheme it was presented with", async () => {
    mocks.verifyResourceRequest.mockRejectedValue(
      new APIError("UNAUTHORIZED", {
        error: "invalid_token",
        error_description: "Invalid access token",
      })
    );

    const response = await GET(
      makeRequest({ authorization: "DPoP expired-token", dpop: "proof" })
    );

    expect(response.headers.get("WWW-Authenticate")).toBe(
      'DPoP error="invalid_token", error_description="Invalid access token", algs="ES256"'
    );
  });

  it("answers a bad DPoP proof with a DPoP challenge", async () => {
    mocks.verifyResourceRequest.mockRejectedValue(
      new APIError("UNAUTHORIZED", {
        error: "invalid_dpop_proof",
        error_description: 'DPoP proof typ must be "dpop+jwt"',
      })
    );

    const response = await GET(
      makeRequest({ authorization: "DPoP test-token", dpop: "bad-proof" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `DPoP error="invalid_dpop_proof", error_description="DPoP proof typ must be 'dpop+jwt'", algs="ES256"`
    );
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_dpop_proof",
    });
  });

  it("answers missing validity scopes with an insufficient_scope challenge", async () => {
    mocks.verifyResourceRequest.mockResolvedValue(
      verifiedToken(["openid", "email"])
    );

    const response = await GET(
      makeRequest({ authorization: "DPoP test-token", dpop: "test-proof" })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer error="insufficient_scope", scope="poh", ${RESOURCE_METADATA}, error_description="access token needs the poh scope, a proof scope, or an identity scope"`
    );
    await expect(response.json()).resolves.toMatchObject({
      error: "insufficient_scope",
      scope: "poh",
    });
    expect(mocks.getRpValidityState).not.toHaveBeenCalled();
  });

  it("returns the RP validity state for an authorized caller", async () => {
    mocks.verifyResourceRequest.mockResolvedValue(
      verifiedToken(["openid", "proof:verification"])
    );
    mocks.getRpValidityState.mockResolvedValue({
      eventId: "event-1",
      eventKind: "revoked",
      occurredAt: "2026-04-20T15:00:00.000Z",
      reason: "Document revoked",
      validityStatus: "revoked",
    });

    const response = await GET(
      makeRequest({
        authorization: "DPoP test-token",
        dpop: "test-proof",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventId: "event-1",
      eventKind: "revoked",
      occurredAt: "2026-04-20T15:00:00.000Z",
      reason: "Document revoked",
      validityStatus: "revoked",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getRpValidityState).toHaveBeenCalledWith({
      clientId: "client-1",
      sub: "pairwise-sub-1",
    });
  });
});
