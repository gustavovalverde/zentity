import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  getScenarioValidityState: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  isRouteScenarioId: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: routeMocks.headers,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({
    api: {
      getSession: routeMocks.getSession,
    },
  })),
}));

vi.mock("@/scenarios/route-scenario-registry", () => ({
  isRouteScenarioId: routeMocks.isRouteScenarioId,
}));

vi.mock("@/lib/validity", () => ({
  getScenarioValidityState: routeMocks.getScenarioValidityState,
}));

import { GET } from "./route";

describe("GET /api/auth/validity-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.headers.mockResolvedValue(new Headers());
    routeMocks.isRouteScenarioId.mockReturnValue(true);
    routeMocks.getSession.mockResolvedValue({
      user: { id: "user-123" },
    });
    routeMocks.getScenarioValidityState.mockResolvedValue({
      clientId: "client-123",
      latestNotice: null,
      scenarioId: "bank",
      pullError: null,
      snapshot: {
        eventId: "event-1",
        eventKind: "verified",
        occurredAt: "2026-04-21T10:00:00.000Z",
        reason: null,
        validityStatus: "verified",
      },
      subject: "pairwise-sub-1",
    });
  });

  it("rejects invalid provider ids", async () => {
    routeMocks.isRouteScenarioId.mockReturnValue(false);

    const response = await GET(
      new Request("http://localhost/api/auth/validity-state?scenarioId=nope")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or missing scenarioId",
    });
  });

  it("requires an authenticated session", async () => {
    routeMocks.getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/auth/validity-state?scenarioId=bank")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
  });

  it("returns the provider validity state for the current session", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/validity-state?scenarioId=bank")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      clientId: "client-123",
      latestNotice: null,
      scenarioId: "bank",
      pullError: null,
      snapshot: {
        eventId: "event-1",
        eventKind: "verified",
        occurredAt: "2026-04-21T10:00:00.000Z",
        reason: null,
        validityStatus: "verified",
      },
      subject: "pairwise-sub-1",
    });
    expect(routeMocks.getScenarioValidityState).toHaveBeenCalledWith({
      scenarioId: "bank",
      userId: "user-123",
    });
  });
});
