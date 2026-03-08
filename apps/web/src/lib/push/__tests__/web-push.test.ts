import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockSendNotification = vi.fn();

class MockWebPushError extends Error {
  body: string;
  endpoint: string;
  headers: Record<string, string>;
  statusCode: number;
  constructor(
    message: string,
    statusCode: number,
    headers: Record<string, string> = {},
    body = "",
    endpoint = ""
  ) {
    super(message);
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = body;
    this.endpoint = endpoint;
  }
}

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    WebPushError: MockWebPushError,
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

describe("sendWebPush", () => {
  beforeEach(() => {
    mockSendNotification.mockReset();
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
    mockSendNotification.mockResolvedValue(undefined);

    const { sendWebPush } = await import("../web-push");
    await sendWebPush("user-1", {
      title: "Test",
      body: "Hello",
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: subs[0].endpoint, keys: { p256dh: "key1", auth: "auth1" } },
      expect.any(String),
      expect.objectContaining({ TTL: 300 })
    );
  });

  it("auto-deletes subscriptions on 410 Gone", async () => {
    mockDbSelect.mockResolvedValue([
      {
        id: "1",
        endpoint: "https://fcm.googleapis.com/push/stale",
        p256dh: "k",
        auth: "a",
      },
    ]);

    const error = new MockWebPushError("Gone", 410);
    mockSendNotification.mockRejectedValue(error);
    mockDbDelete.mockResolvedValue(undefined);

    const { sendWebPush } = await import("../web-push");
    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockDbDelete).toHaveBeenCalled();
  });

  it("short-circuits when no subscriptions exist", async () => {
    mockDbSelect.mockResolvedValue([]);

    const { sendWebPush } = await import("../web-push");
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

    const { sendWebPush } = await import("../web-push");
    await expect(
      sendWebPush("user-1", { title: "Test", body: "Hello" })
    ).resolves.toBeUndefined();
  });
});

describe("sendWebPush without VAPID", () => {
  it("short-circuits when VAPID keys are not configured", async () => {
    vi.resetModules();

    vi.doMock("server-only", () => ({}));
    vi.doMock("web-push", () => ({
      default: {
        sendNotification: mockSendNotification,
        WebPushError: MockWebPushError,
      },
    }));
    vi.doMock("@/lib/db/connection", () => ({
      db: {
        select: () => ({ from: () => ({ where: mockDbSelect }) }),
        delete: () => ({ where: mockDbDelete }),
      },
    }));
    vi.doMock("@/lib/logging/error-logger", () => ({
      logError: vi.fn(),
      logWarn: vi.fn(),
    }));
    vi.doMock("@/env", () => ({
      env: {
        VAPID_PUBLIC_KEY: undefined,
        VAPID_PRIVATE_KEY: undefined,
        VAPID_SUBJECT: "mailto:test@zentity.xyz",
      },
    }));

    const { sendWebPush } = await import("../web-push");
    await sendWebPush("user-1", { title: "Test", body: "Hello" });

    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
