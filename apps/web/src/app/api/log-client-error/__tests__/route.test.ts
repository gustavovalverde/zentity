import type { NextRequest } from "next/server";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

const logError = vi.fn();
vi.mock("@/lib/logging/logger", () => ({
  createRequestLogger: () => ({ error: logError }),
}));

import { POST } from "../route";

describe("log-client-error route", () => {
  beforeEach(() => {
    logError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("omits message and stack in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const req = new Request("http://localhost/api/log-client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "email test@example.com 1234567",
        stack: "stack test@example.com 1234567",
        path: "https://example.com/path?x=1",
      }),
    });

    const response = await POST(req as unknown as NextRequest);
    expect(response.status).toBe(200);

    const payload = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.path).toBe("/path");
    expect(payload.message).toBeUndefined();
    expect(payload.stack).toBeUndefined();
  });

  it("sanitizes message and stack in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const req = new Request("http://localhost/api/log-client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "email test@example.com 1234567",
        stack: "stack test@example.com 1234567",
        path: "https://example.com/other?y=1",
      }),
    });

    const response = await POST(req as unknown as NextRequest);
    expect(response.status).toBe(200);

    const payload = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.path).toBe("/other");
    expect(String(payload.message)).toContain("[redacted-email]");
    expect(String(payload.message)).toContain("[redacted-number]");
    expect(String(payload.stack)).toContain("[redacted-email]");
    expect(String(payload.stack)).toContain("[redacted-number]");
  });
});
