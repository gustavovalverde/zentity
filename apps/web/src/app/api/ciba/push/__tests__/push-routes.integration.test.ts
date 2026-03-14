import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireSession: authMocks.requireSession,
}));

import { db } from "@/lib/db/connection";
import { pushSubscriptions } from "@/lib/db/schema/push";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import { POST as subscribe } from "../subscribe/route";
import { POST as unsubscribe } from "../unsubscribe/route";

function mockSession(userId: string) {
  authMocks.requireSession.mockResolvedValue({
    ok: true,
    session: { user: { id: userId } },
  });
}

function mockUnauthorized() {
  const { NextResponse } =
    require("next/server") as typeof import("next/server");
  authMocks.requireSession.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
}

function makeSubscribeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ciba/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeUnsubscribeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ciba/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XFaT",
    auth: "tBHItJI5svbpC7sBIF-NTw",
  },
};

describe("POST /api/ciba/push/subscribe", () => {
  beforeEach(async () => {
    await resetDatabase();
    authMocks.requireSession.mockReset();
  });

  it("returns 401 when no session", async () => {
    mockUnauthorized();
    const res = await subscribe(makeSubscribeRequest(validSubscription));
    expect(res.status).toBe(401);
  });

  it("stores a valid subscription", async () => {
    const userId = await createTestUser();
    mockSession(userId);

    const res = await subscribe(makeSubscribeRequest(validSubscription));
    expect(res.status).toBe(201);

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe(validSubscription.endpoint);
    expect(rows[0].p256dh).toBe(validSubscription.keys.p256dh);
    expect(rows[0].auth).toBe(validSubscription.keys.auth);
  });

  it("upserts on duplicate endpoint", async () => {
    const userId = await createTestUser();
    mockSession(userId);

    await subscribe(makeSubscribeRequest(validSubscription));

    const updatedKeys = {
      ...validSubscription,
      keys: { p256dh: "new-p256dh-key", auth: "new-auth-key" },
    };
    const res = await subscribe(makeSubscribeRequest(updatedKeys));
    expect(res.status).toBe(201);

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("new-p256dh-key");
    expect(rows[0].auth).toBe("new-auth-key");
  });

  it("returns 400 for invalid payload", async () => {
    const userId = await createTestUser();
    mockSession(userId);

    const res = await subscribe(
      makeSubscribeRequest({ endpoint: "not-a-url" })
    );
    expect(res.status).toBe(400);
  });

  it("transfers endpoint ownership when a different user re-subscribes", async () => {
    const userA = await createTestUser({ email: "user-a@test.com" });
    const userB = await createTestUser({ email: "user-b@test.com" });

    // User A subscribes
    mockSession(userA);
    await subscribe(makeSubscribeRequest(validSubscription));

    const rowsA = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, validSubscription.endpoint));
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].userId).toBe(userA);

    // User B re-subscribes with the same endpoint
    mockSession(userB);
    const res = await subscribe(makeSubscribeRequest(validSubscription));
    expect(res.status).toBe(201);

    const rowsB = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, validSubscription.endpoint));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].userId).toBe(userB);

    // User A no longer has any subscriptions
    const rowsForA = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userA));
    expect(rowsForA).toHaveLength(0);
  });
});

describe("POST /api/ciba/push/unsubscribe", () => {
  beforeEach(async () => {
    await resetDatabase();
    authMocks.requireSession.mockReset();
  });

  it("returns 401 when no session", async () => {
    mockUnauthorized();
    const res = await unsubscribe(
      makeUnsubscribeRequest({ endpoint: validSubscription.endpoint })
    );
    expect(res.status).toBe(401);
  });

  it("deletes matching subscription", async () => {
    const userId = await createTestUser();
    mockSession(userId);

    await subscribe(makeSubscribeRequest(validSubscription));

    const res = await unsubscribe(
      makeUnsubscribeRequest({ endpoint: validSubscription.endpoint })
    );
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    expect(rows).toHaveLength(0);
  });

  it("no-ops when endpoint does not exist", async () => {
    const userId = await createTestUser();
    mockSession(userId);

    const res = await unsubscribe(
      makeUnsubscribeRequest({
        endpoint: "https://fcm.googleapis.com/fcm/send/nonexistent",
      })
    );
    expect(res.status).toBe(200);
  });
});
