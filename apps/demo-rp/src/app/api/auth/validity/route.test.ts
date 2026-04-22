import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createOpenIdTokenVerifier: vi.fn(),
  findProviderByClientId: vi.fn(),
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
  const insertRun = vi.fn().mockResolvedValue(undefined);
  const insertOnConflictDoNothing = vi.fn(() => ({ run: insertRun }));
  const insertValues = vi.fn(() => ({
    onConflictDoNothing: insertOnConflictDoNothing,
  }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const selectAll = vi.fn().mockResolvedValue([
    {
      clientId: "client-123",
      eventId: "event-1",
    },
  ]);
  const selectWhere = vi.fn(() => ({ all: selectAll }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  return {
    db: { insert, select },
    mocks: {
      insert,
      insertRun,
      insertValues,
      selectAll,
    },
  };
}

function makePostRequest(
  token = "validity-token",
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/api/auth/validity", {
    method: "POST",
    headers: {
      "content-type": "application/jwt",
      ...headers,
    },
    body: token,
  });
}

async function loadRoute() {
  const module = await import("./route");
  return module;
}

describe("/api/auth/validity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    routeMocks.createOpenIdTokenVerifier.mockReturnValue({
      verify: routeMocks.verifyToken,
    });
    routeMocks.readDcrClientId.mockResolvedValue("client-123");
    routeMocks.findProviderByClientId.mockResolvedValue("x402");
    routeMocks.verifyToken.mockResolvedValue({
      payload: {
        aud: "client-123",
        sub: "pairwise-sub-1",
        jti: "notice-jti-1",
        events: {
          "https://zentity.xyz/events/validity-change": {
            eventId: "event-1",
            eventKind: "revoked",
            validityStatus: "revoked",
            occurredAt: "2026-04-20T15:00:00.000Z",
            reason: "Document revoked",
          },
        },
      },
    });
  });

  it("accepts a valid RP validity notice and stores it", async () => {
    const { db, mocks } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    const { POST } = await loadRoute();

    const response = await POST(makePostRequest());

    expect(response.status).toBe(202);
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-123",
        eventId: "event-1",
        eventKind: "revoked",
        jti: "notice-jti-1",
        providerId: "x402",
        sub: "pairwise-sub-1",
        validityStatus: "revoked",
      })
    );
    expect(mocks.insertRun).toHaveBeenCalledOnce();
  });

  it("rejects requests that do not send application/jwt", async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      makePostRequest("validity-token", {
        "content-type": "application/json",
      })
    );

    expect(response.status).toBe(415);
  });

  it("returns 503 when no RP client ids are registered", async () => {
    routeMocks.readDcrClientId.mockResolvedValue(null);
    routeMocks.getDb.mockReturnValue(createDbMock().db);
    const { POST } = await loadRoute();

    const response = await POST(makePostRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "No registered clients — cannot validate validity notice",
    });
  });

  it("returns stored notices for a client on GET", async () => {
    const { db, mocks } = createDbMock();
    routeMocks.getDb.mockReturnValue(db);
    const { GET } = await loadRoute();

    const response = await GET(
      new Request("http://localhost/api/auth/validity?clientId=client-123")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      notices: [{ clientId: "client-123", eventId: "event-1" }],
    });
    expect(mocks.selectAll).toHaveBeenCalledOnce();
  });
});
