import { beforeEach, describe, expect, it, vi } from "vitest";

const dcrMocks = vi.hoisted(() => ({
  isValidProviderId: vi.fn(),
  readDcrClientId: vi.fn(),
  saveDcrClientId: vi.fn(),
}));

vi.mock("@/lib/dcr", () => dcrMocks);

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3102",
    ZENTITY_URL: "http://localhost:3000",
  },
}));

import { POST } from "./route";

describe("/api/dcr POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dcrMocks.isValidProviderId.mockReturnValue(true);
    dcrMocks.saveDcrClientId.mockResolvedValue(undefined);
  });

  it("registers a client and persists the client_id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "client-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const response = await POST(
      new Request("http://localhost:3102/api/dcr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "bank",
          clientName: "Velocity Private",
          scopes: "openid email proof:verification",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      client_id: "client-123",
      redirect_uri:
        "http://localhost:3102/api/auth/oauth2/callback/zentity-bank",
    });
    expect(dcrMocks.saveDcrClientId).toHaveBeenCalledWith("bank", "client-123");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/oauth2/register",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = JSON.parse(
      ((requestInit as RequestInit | undefined)?.body as string) ?? "{}"
    );
    expect(requestBody).toMatchObject({
      backchannel_logout_uri:
        "http://localhost:3102/api/auth/backchannel-logout",
      rp_validity_notice_enabled: true,
      rp_validity_notice_uri: "http://localhost:3102/api/auth/validity",
    });
  });

  it("returns JSON when local persistence fails after upstream registration", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "client-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    dcrMocks.saveDcrClientId.mockRejectedValueOnce(
      new Error("SQLITE_ERROR: no such table: dcr_client")
    );

    const response = await POST(
      new Request("http://localhost:3102/api/dcr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "bank",
          clientName: "Velocity Private",
          scopes: "openid email proof:verification",
        }),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "Failed to persist DCR client: SQLITE_ERROR: no such table: dcr_client",
    });
  });
});
