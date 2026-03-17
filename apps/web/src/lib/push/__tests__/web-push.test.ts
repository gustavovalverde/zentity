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
  env: {
    VAPID_PUBLIC_KEY: "test-public-key",
    VAPID_PRIVATE_KEY: "test-private-key",
    VAPID_SUBJECT: "mailto:test@zentity.xyz",
  },
}));

vi.mock("@/lib/logging/error-logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import type { PushTransport } from "../web-push";

// Import the mock module to reconfigure env properties in beforeEach,
// making the test resilient to vmThreads mock factory leaking.
import { env } from "@/env";

import { sendWebPush } from "../web-push";

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
    // Reconfigure env properties directly on the mock object.
    // This is resilient to vmThreads leaking another file's @/env mock factory.
    Object.defineProperty(env, "VAPID_PUBLIC_KEY", {
      value: "test-public-key",
      writable: true,
      configurable: true,
    });
    Object.defineProperty(env, "VAPID_PRIVATE_KEY", {
      value: "test-private-key",
      writable: true,
      configurable: true,
    });
    Object.defineProperty(env, "VAPID_SUBJECT", {
      value: "mailto:test@zentity.xyz",
      writable: true,
      configurable: true,
    });
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

    await sendWebPush("user-1", { title: "Test", body: "Hello" }, transport);

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

    await sendWebPush("user-1", { title: "Test", body: "Hello" }, transport);

    expect(mockDbDelete).toHaveBeenCalledWith(
      expect.objectContaining({ col: "id", val: "sub-42" })
    );
  });

  it("short-circuits when no subscriptions exist", async () => {
    mockDbSelect.mockResolvedValue([]);
    const transport = createMockTransport();

    await sendWebPush("user-1", { title: "Test", body: "Hello" }, transport);

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
      sendWebPush("user-1", { title: "Test", body: "Hello" }, transport)
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
      transport
    );

    const serialized = transport.sendNotification.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(serialized);
    expect(parsed.data.requiresVaultUnlock).toBe(true);
  });

  it("short-circuits when VAPID keys are not configured", async () => {
    Object.defineProperty(env, "VAPID_PUBLIC_KEY", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(env, "VAPID_PRIVATE_KEY", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const transport = createMockTransport();

    await sendWebPush("user-1", { title: "Test", body: "Hello" }, transport);

    expect(transport.sendNotification).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
