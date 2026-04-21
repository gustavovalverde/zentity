import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveProtectedResourcePrincipal: vi.fn(),
  getRpValidityState: vi.fn(),
}));

vi.mock("@/lib/auth/oidc/resource-principal", () => ({
  resolveProtectedResourcePrincipal: mocks.resolveProtectedResourcePrincipal,
}));

vi.mock("@/lib/identity/validity/rp-notice", () => ({
  getRpValidityState: mocks.getRpValidityState,
}));

import { GET } from "./route";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/oauth2/validity", {
    method: "GET",
    headers,
  });
}

describe("GET /api/auth/oauth2/validity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the caller cannot be resolved", async () => {
    mocks.resolveProtectedResourcePrincipal.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_token",
    });
  });

  it("returns 403 when the caller lacks validity scopes", async () => {
    mocks.resolveProtectedResourcePrincipal.mockResolvedValue({
      clientId: "client-1",
      dpopJkt: "thumbprint-1",
      scopes: ["openid", "email"],
      sub: "pairwise-sub-1",
      userId: "user-1",
    });

    const response = await GET(
      makeRequest({
        authorization: "DPoP test-token",
        dpop: "test-proof",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "insufficient_scope",
    });
    expect(mocks.getRpValidityState).not.toHaveBeenCalled();
  });

  it("returns the RP validity state for an authorized caller", async () => {
    mocks.resolveProtectedResourcePrincipal.mockResolvedValue({
      clientId: "client-1",
      dpopJkt: "thumbprint-1",
      scopes: ["openid", "proof:verification"],
      sub: "pairwise-sub-1",
      userId: "user-1",
    });
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
