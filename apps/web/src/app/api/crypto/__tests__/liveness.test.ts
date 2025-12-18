/**
 * Tests for liveness FHE operations via tRPC.
 */

import type { Session } from "@/lib/auth/auth";

/* eslint @typescript-eslint/no-explicit-any: off */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cryptoRouter } from "@/lib/trpc/routers/crypto";

// Store original fetch
const originalFetch = global.fetch;

function createCaller(session: Session | null) {
  return cryptoRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    session,
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

describe("Liveness FHE (tRPC)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("encryptLiveness", () => {
    it("should throw UNAUTHORIZED when not authenticated", async () => {
      const caller = createCaller(null);
      await expect(
        caller.encryptLiveness({ score: 0.85 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should throw BAD_REQUEST when score is missing", async () => {
      const caller = createCaller(authedSession);
      await expect(caller.encryptLiveness({} as any)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("should throw BAD_REQUEST when score is out of range (> 1.0)", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ score: 1.5 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should throw BAD_REQUEST when score is negative", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ score: -0.1 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should encrypt valid liveness score", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve({
              ciphertext: "encrypted-ciphertext-base64",
              clientKeyId: "default",
              score: 0.85,
            }),
        }),
      );

      const caller = createCaller(authedSession);
      const data = await caller.encryptLiveness({ score: 0.85 });
      expect(data.ciphertext).toBe("encrypted-ciphertext-base64");
      expect(data.clientKeyId).toBe("default");
      expect(data.score).toBe(0.85);
    });

    it("should handle FHE service errors", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("FHE service unavailable"),
          json: () => Promise.resolve({ error: "FHE service unavailable" }),
        }),
      );

      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ score: 0.85 }),
      ).rejects.toBeInstanceOf(Error);
    });

    it("should accept boundary values (0.0 and 1.0)", async () => {
      const fetchMock = setFetchMock(
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve({
              ciphertext: "encrypted",
              clientKeyId: "default",
              score: 0.0,
            }),
        }),
      );

      // Test score = 0.0
      const caller = createCaller(authedSession);
      const response0 = await caller.encryptLiveness({ score: 0.0 });
      expect(response0.score).toBe(0.0);

      // Test score = 1.0
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            ciphertext: "encrypted",
            clientKeyId: "default",
            score: 1.0,
          }),
      });

      const response1 = await caller.encryptLiveness({ score: 1.0 });
      expect(response1.score).toBe(1.0);
    });
  });

  describe("verifyLivenessThreshold", () => {
    it("should throw UNAUTHORIZED when not authenticated", async () => {
      const caller = createCaller(null);
      await expect(
        caller.verifyLivenessThreshold({ ciphertext: "test", threshold: 0.3 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should throw BAD_REQUEST when ciphertext is missing", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.verifyLivenessThreshold({ threshold: 0.3 } as any),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should throw BAD_REQUEST when threshold is out of range", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.verifyLivenessThreshold({ ciphertext: "test", threshold: 1.5 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should use default threshold (0.3) when not provided", async () => {
      let capturedBody: any;
      setFetchMock(
        vi.fn().mockImplementation((_url, options) => {
          capturedBody = JSON.parse(options?.body as string);
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            json: () =>
              Promise.resolve({
                passesThreshold: true,
                threshold: 0.3,
                computationTimeMs: 100,
              }),
          });
        }),
      );

      const caller = createCaller(authedSession);
      await caller.verifyLivenessThreshold({ ciphertext: "encrypted-data" });
      expect(capturedBody.threshold).toBe(0.3);
    });

    it("should verify threshold successfully", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve({
              passesThreshold: true,
              threshold: 0.5,
              computationTimeMs: 150,
            }),
        }),
      );

      const caller = createCaller(authedSession);
      const data = await caller.verifyLivenessThreshold({
        ciphertext: "encrypted-data",
        threshold: 0.5,
      });

      expect(data.passesThreshold).toBe(true);
      expect(data.threshold).toBe(0.5);
      expect(data.computationTimeMs).toBe(150);
    });

    it("should return false when threshold not met", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () =>
            Promise.resolve({
              passesThreshold: false,
              threshold: 0.9,
              computationTimeMs: 150,
            }),
        }),
      );

      const caller = createCaller(authedSession);
      const data = await caller.verifyLivenessThreshold({
        ciphertext: "encrypted-data",
        threshold: 0.9,
      });
      expect(data.passesThreshold).toBe(false);
    });
  });
});
