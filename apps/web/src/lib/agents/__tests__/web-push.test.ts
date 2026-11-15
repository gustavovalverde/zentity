import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockSendNotification = vi.fn();
vi.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  WebPushError: class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

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

// Note: do NOT mock drizzle-orm here — it poisons the vmThread module cache
// for subsequent test files. The db is fully mocked via @/lib/db/connection,
// so the real eq() from drizzle-orm works fine with the mock chain.

vi.mock("@/lib/db/schema/ciba", () => ({
  pushSubscriptions: {
    id: "id",
    userId: "userId",
    endpoint: "endpoint",
    p256dh: "p256dh",
    auth: "auth",
  },
}));

const mockEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("@/env", () => ({
  env: mockEnv,
}));

vi.mock("@/lib/logging/error-logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { WebPushError } from "web-push";

import { sendWebPush } from "../push-sender";

const TEST_VAPID = {
  VAPID_PUBLIC_KEY: "test-public-key",
  VAPID_PRIVATE_KEY: "test-private-key",
  VAPID_SUBJECT: "mailto:test@zentity.xyz",
};

describe("sendWebPush", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbDelete.mockReset();
    mockSendNotification.mockReset();
    mockSendNotification.mockResolvedValue(undefined);
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key];
    }
    Object.assign(mockEnv, TEST_VAPID);
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
    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
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

    mockSendNotification.mockRejectedValue(
      new WebPushError("Gone", 410, {}, "", "")
    );
    mockDbDelete.mockResolvedValue(undefined);

    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockDbDelete).toHaveBeenCalled();
  });

  it("keeps subscriptions on non-gone push service errors", async () => {
    mockDbSelect.mockResolvedValue([
      {
        id: "sub-1",
        endpoint: "https://fcm.googleapis.com/push/1",
        p256dh: "k",
        auth: "a",
      },
    ]);
    mockSendNotification.mockRejectedValue(
      new WebPushError("Server error", 500, {}, "", "")
    );

    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("short-circuits when no subscriptions exist", async () => {
    mockDbSelect.mockResolvedValue([]);
    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockSendNotification).not.toHaveBeenCalled();
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
    mockSendNotification.mockRejectedValue(new Error("network error"));

    await expect(
      sendWebPush("user-1", { title: "Test", body: "Hello" })
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
    await sendWebPush("user-1", {
      title: "Auth Request",
      body: "App: buy things",
      data: { authReqId: "req-1", requiresVaultUnlock: true },
    });

    const serialized = mockSendNotification.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(serialized);
    expect(parsed.data.requiresVaultUnlock).toBe(true);
  });

  it("short-circuits when VAPID keys are not configured", async () => {
    mockEnv.VAPID_PUBLIC_KEY = undefined;
    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
