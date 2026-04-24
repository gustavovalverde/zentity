import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createOpenIdTokenVerifier: vi.fn(),
  findRouteScenarioByClientId: vi.fn(),
  getDb: vi.fn(),
  readDcrClientId: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("@zentity/sdk/rp", () => ({
  createOpenIdTokenVerifier: routeMocks.createOpenIdTokenVerifier,
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: routeMocks.getDb,
}));

vi.mock("@/lib/dcr", () => ({
  findRouteScenarioByClientId: routeMocks.findRouteScenarioByClientId,
  readDcrClientId: routeMocks.readDcrClientId,
}));

vi.mock("@/scenarios/route-scenario-registry", () => ({
  ROUTE_SCENARIO_IDS: ["x402"],
  getOAuthProviderId: (scenarioId: string) => `zentity-${scenarioId}`,
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
    routeMocks.createOpenIdTokenVerifier.mockReturnValue({
      verify: routeMocks.verifyToken,
    });
    routeMocks.readDcrClientId.mockResolvedValue("client-123");
    routeMocks.findRouteScenarioByClientId.mockResolvedValue("x402");
    routeMocks.verifyToken.mockResolvedValue({
      payload: {
        aud: "client-123",
        events: {
          "http://schemas.openid.net/event/backchannel-logout": {},
        },
        sub: "pairwise-sub",
      },
    });
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
    routeMocks.verifyToken.mockResolvedValueOnce({
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
    routeMocks.verifyToken.mockResolvedValue({
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

  it("returns 503 when no RP client ids are registered", async () => {
    routeMocks.readDcrClientId.mockResolvedValue(null);
    const { db } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    const POST = await loadRoute();

    const response = await POST(makeRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "No registered clients — cannot validate logout token",
    });
  });
});
