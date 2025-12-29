/**
 * Tests for age FHE operations via tRPC.
 */

import type { Session } from "@/lib/auth/auth";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cryptoRouter } from "@/lib/trpc/routers/crypto";

const originalFetch = global.fetch;

function createCaller(session: Session | null) {
  return cryptoRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    session,
    requestId: "test-request-id",
  });
}

const authedSession = {
  user: { id: "test-user" },
  session: { id: "test-session" },
} as any as Session;

function setFetchMock(fetchMock: unknown) {
  const fn = fetchMock as { preconnect?: unknown };
  fn.preconnect = vi.fn();
  global.fetch = fetchMock as typeof fetch;
  return fetchMock as ReturnType<typeof vi.fn>;
}

describe("Age FHE (tRPC)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("registerFheKey", () => {
    it("should throw UNAUTHORIZED when not authenticated", async () => {
      const caller = createCaller(null);
      await expect(
        caller.registerFheKey({ serverKey: "server-key" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("registers server key when authenticated", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ keyId: "key-123" }),
        }),
      );

      const caller = createCaller(authedSession);
      const response = await caller.registerFheKey({
        serverKey: "server-key",
      });

      expect(response.keyId).toBe("key-123");
    });
  });

  describe("verifyAgeFhe", () => {
    it("should throw BAD_REQUEST when keyId is missing", async () => {
      const caller = createCaller(null);
      await expect(
        caller.verifyAgeFhe({ ciphertext: "ciphertext" } as any),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("returns encrypted result ciphertext", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve({
              resultCiphertext: "encrypted-result",
            }),
        }),
      );

      const caller = createCaller(null);
      const response = await caller.verifyAgeFhe({
        ciphertext: "ciphertext",
        currentYear: 2025,
        minAge: 18,
        keyId: "key-1",
      });

      expect(response.resultCiphertext).toBe("encrypted-result");
    });
  });
});
