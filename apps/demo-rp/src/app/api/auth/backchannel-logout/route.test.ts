import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  findProviderByClientId: vi.fn(),
  getDb: vi.fn(),
  jwtVerify: vi.fn(),
  readDcrClientId: vi.fn(),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: routeMocks.createRemoteJWKSet,
  jwtVerify: routeMocks.jwtVerify,
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: routeMocks.getDb,
}));

vi.mock("@/lib/dcr", () => ({
  PROVIDER_IDS: ["x402"],
  findProviderByClientId: routeMocks.findProviderByClientId,
  readDcrClientId: routeMocks.readDcrClientId,
}));

vi.mock("@/lib/env", () => ({
  env: {
    ZENTITY_URL: "http://zentity.example",
  },
}));

function createDbMock() {
  const accountRows = [{ userId: "user-1" }];
  const selectAll = vi.fn().mockResolvedValue(accountRows);
  const selectWhere = vi.fn(() => ({ all: selectAll }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateRun = vi.fn().mockResolvedValue(undefined);
  const updateWhere = vi.fn(() => ({ run: updateRun }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteRun = vi.fn().mockResolvedValue(undefined);
  const deleteWhere = vi.fn(() => ({ run: deleteRun }));
  const deleteTable = vi.fn(() => ({ where: deleteWhere }));
  const deleteFn = vi.fn(deleteTable);

  const db = {
    delete: deleteFn,
    select,
    update,
  };

  return {
    db,
    mocks: {
      deleteFn,
      deleteRun,
      deleteWhere,
      select,
      selectAll,
      updateRun,
    },
  };
}

function makeRequest(logoutToken = "logout-token") {
  return new Request("http://localhost/api/auth/backchannel-logout", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ logout_token: logoutToken }),
  });
}

async function loadRoute() {
  const module = await import("./route");
  return module.POST;
}

describe("POST /api/auth/backchannel-logout", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    routeMocks.readDcrClientId.mockResolvedValue("client-123");
    routeMocks.findProviderByClientId.mockResolvedValue("x402");
    routeMocks.jwtVerify.mockResolvedValue({
      payload: {
        aud: "client-123",
        events: {
          "http://schemas.openid.net/event/backchannel-logout": {},
        },
        sub: "pairwise-sub",
      },
    });
    routeMocks.createRemoteJWKSet.mockReturnValue("jwks");
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issuer: "http://zentity.example",
            jwks_uri: "http://zentity.example/api/auth/oauth2/jwks",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
  });

  it("deletes RP sessions for a valid backchannel logout token", async () => {
    const { db, mocks } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    const POST = await loadRoute();

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(mocks.deleteFn).toHaveBeenCalledOnce();
    expect(mocks.deleteRun).toHaveBeenCalledOnce();
  });

  it("rejects logout tokens that carry a nonce claim", async () => {
    const { db, mocks } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    routeMocks.jwtVerify.mockResolvedValueOnce({
      payload: {
        aud: "client-123",
        events: {
          "http://schemas.openid.net/event/backchannel-logout": {},
        },
        nonce: "unexpected-nonce",
        sub: "pairwise-sub",
      },
    });
    const POST = await loadRoute();

    const response = await POST(makeRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Logout token must not contain nonce",
    });
    expect(mocks.updateRun).not.toHaveBeenCalled();
    expect(mocks.deleteRun).not.toHaveBeenCalled();
  });

  it("rejects replayed logout token jti values", async () => {
    const { db, mocks } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    routeMocks.jwtVerify.mockResolvedValue({
      payload: {
        aud: "client-123",
        events: {
          "http://schemas.openid.net/event/backchannel-logout": {},
        },
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: "logout-jti-1",
        sub: "pairwise-sub",
      },
    });
    const POST = await loadRoute();

    const firstResponse = await POST(makeRequest());
    const secondResponse = await POST(makeRequest());

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(400);
    await expect(secondResponse.json()).resolves.toEqual({
      error: "Logout token has already been used",
    });
    expect(mocks.updateRun).toHaveBeenCalledOnce();
    expect(mocks.deleteRun).toHaveBeenCalledOnce();
  });

  it("refreshes discovery metadata after the cache TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { db } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    const POST = await loadRoute();

    try {
      const firstResponse = await POST(makeRequest("logout-token-a"));
      vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
      const secondResponse = await POST(makeRequest("logout-token-b"));

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
