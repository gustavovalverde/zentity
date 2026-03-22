import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: {} }));

const mockDbSelect = vi.fn();
const mockDbDelete = vi.fn();
vi.mock("@/lib/db/connection", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockDbSelect,
      }),
    }),
    delete: () => ({
      where: mockDbDelete,
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: string) => ({ col, val }),
}));

vi.mock("@/lib/db/schema/push", () => ({
  pushSubscriptions: {
    id: "id",
    userId: "userId",
    endpoint: "endpoint",
    p256dh: "p256dh",
    auth: "auth",
  },
}));

vi.mock("@/env", () => ({
  env: {},
}));

vi.mock("@/lib/logging/error-logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { sendWebPush } from "../web-push";

type PushTransport = Parameters<typeof sendWebPush>[2];

const TEST_VAPID = {
  publicKey: "test-public-key",
  privateKey: "test-private-key",
  subject: "mailto:test@zentity.xyz",
};

function createMockTransport(): PushTransport & {
  sendNotification: ReturnType<typeof vi.fn>;
} {
  return {
    sendNotification: vi.fn().mockResolvedValue(undefined),
    isGoneError: (error: unknown) =>
      error instanceof Error && error.message === "Gone",
  };
}

describe("sendWebPush", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbDelete.mockReset();
  });

  it("sends to all user subscriptions", async () => {
    const subs = [
      {
        id: "1",
        endpoint: "https://fcm.googleapis.com/push/1",
        p256dh: "key1",
        auth: "auth1",
      },
      {
        id: "2",
        endpoint: "https://fcm.googleapis.com/push/2",
        p256dh: "key2",
        auth: "auth2",
      },
    ];
    mockDbSelect.mockResolvedValue(subs);
    const transport = createMockTransport();

    await sendWebPush(
      "user-1",
      { title: "Test", body: "Hello" },
      transport,
      TEST_VAPID
    );

    expect(transport.sendNotification).toHaveBeenCalledTimes(2);
    expect(transport.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subs[0]?.endpoint,
        keys: { p256dh: "key1", auth: "auth1" },
      },
      expect.any(String),
      expect.objectContaining({ TTL: 300 })
    );
  });

  it("auto-deletes subscriptions on gone error by row id", async () => {
    mockDbSelect.mockResolvedValue([
      {
        id: "sub-42",
        endpoint: "https://fcm.googleapis.com/push/stale",
        p256dh: "k",
        auth: "a",
      },
    ]);

    const transport = createMockTransport();
    transport.sendNotification.mockRejectedValue(new Error("Gone"));
    mockDbDelete.mockResolvedValue(undefined);

    await sendWebPush(
      "user-1",
      { title: "Test", body: "Hello" },
      transport,
      TEST_VAPID
    );

    expect(mockDbDelete).toHaveBeenCalledWith(
      expect.objectContaining({ col: "id", val: "sub-42" })
    );
  });

  it("short-circuits when no subscriptions exist", async () => {
    mockDbSelect.mockResolvedValue([]);
    const transport = createMockTransport();

    await sendWebPush(
      "user-1",
      { title: "Test", body: "Hello" },
      transport,
      TEST_VAPID
    );

    expect(transport.sendNotification).not.toHaveBeenCalled();
  });

  it("does not throw on delivery failures", async () => {
    mockDbSelect.mockResolvedValue([
      {
        id: "1",
        endpoint: "https://fcm.googleapis.com/push/1",
        p256dh: "k",
        auth: "a",
      },
    ]);
    const transport = createMockTransport();
    transport.sendNotification.mockRejectedValue(new Error("network error"));

    await expect(
      sendWebPush(
        "user-1",
        { title: "Test", body: "Hello" },
        transport,
        TEST_VAPID
      )
    ).resolves.toBeUndefined();
  });

  it("preserves requiresVaultUnlock flag in serialized payload", async () => {
    mockDbSelect.mockResolvedValue([
      {
        id: "1",
        endpoint: "https://fcm.googleapis.com/push/1",
        p256dh: "k",
        auth: "a",
      },
    ]);
    const transport = createMockTransport();

    await sendWebPush(
      "user-1",
      {
        title: "Auth Request",
        body: "App: buy things",
        data: { authReqId: "req-1", requiresVaultUnlock: true },
      },
      transport,
      TEST_VAPID
    );

    const serialized = transport.sendNotification.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(serialized);
    expect(parsed.data.requiresVaultUnlock).toBe(true);
  });

  it("short-circuits when VAPID keys are not configured", async () => {
    const transport = createMockTransport();

    // No vapid parameter and env has no VAPID keys → short-circuit
    await sendWebPush("user-1", { title: "Test", body: "Hello" }, transport);

    expect(transport.sendNotification).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
