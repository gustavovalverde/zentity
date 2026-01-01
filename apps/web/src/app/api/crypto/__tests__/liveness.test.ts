/**
 * Tests for liveness FHE operations via tRPC.
 */

import type { Session } from "@/lib/auth/auth";

import { gunzipSync } from "node:zlib";

/* eslint @typescript-eslint/no-explicit-any: off */
import { decode, encode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cryptoRouter } from "@/lib/trpc/routers/crypto";

// Store original fetch
const originalFetch = global.fetch;

function createCaller(session: Session | null) {
  return cryptoRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
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

function msgpackResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
    headers: new Headers(),
    arrayBuffer: async () => encode(data),
    text: async () => JSON.stringify(data),
  };
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
        caller.encryptLiveness({ score: 0.85, keyId: "key-id" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should throw BAD_REQUEST when score is missing", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ keyId: "key-id" } as any),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should throw BAD_REQUEST when score is out of range (> 1.0)", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ score: 1.5, keyId: "key-id" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should throw BAD_REQUEST when score is negative", async () => {
      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ score: -0.1, keyId: "key-id" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should encrypt valid liveness score", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue(
          msgpackResponse({
            livenessScoreCiphertext: "encrypted-ciphertext-base64",
          }),
        ),
      );

      const caller = createCaller(authedSession);
      const data = await caller.encryptLiveness({
        score: 0.85,
        keyId: "key-id",
      });
      expect(data.ciphertext).toBe("encrypted-ciphertext-base64");
      expect(data.score).toBe(0.85);
    });

    it("should handle FHE service errors", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve("FHE service unavailable"),
        }),
      );

      const caller = createCaller(authedSession);
      await expect(
        caller.encryptLiveness({ score: 0.85, keyId: "key-id" }),
      ).rejects.toBeInstanceOf(Error);
    });

    it("should accept boundary values (0.0 and 1.0)", async () => {
      const fetchMock = setFetchMock(
        vi.fn().mockResolvedValue(
          msgpackResponse({
            livenessScoreCiphertext: "encrypted",
          }),
        ),
      );

      // Test score = 0.0
      const caller = createCaller(authedSession);
      const response0 = await caller.encryptLiveness({
        score: 0.0,
        keyId: "key-id",
      });
      expect(response0.score).toBe(0.0);

      // Test score = 1.0
      fetchMock.mockResolvedValue({
        ...msgpackResponse({
          livenessScoreCiphertext: "encrypted",
        }),
      });

      const response1 = await caller.encryptLiveness({
        score: 1.0,
        keyId: "key-id",
      });
      expect(response1.score).toBe(1.0);
    });
  });

  describe("verifyLivenessThreshold", () => {
    it("should throw UNAUTHORIZED when not authenticated", async () => {
      const caller = createCaller(null);
      await expect(
        caller.verifyLivenessThreshold({
          ciphertext: "test",
          threshold: 0.3,
          keyId: "key-id",
        }),
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
        caller.verifyLivenessThreshold({
          ciphertext: "test",
          threshold: 1.5,
          keyId: "key-id",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("should use default threshold (0.3) when not provided", async () => {
      let capturedBody: any;
      setFetchMock(
        vi.fn().mockImplementation((_url, options) => {
          const bodyBytes = options?.body as Uint8Array;
          capturedBody = decode(gunzipSync(Buffer.from(bodyBytes)));
          return Promise.resolve(
            msgpackResponse({
              passesCiphertext: "encrypted-result",
              threshold: 0.3,
            }),
          );
        }),
      );

      const caller = createCaller(authedSession);
      await caller.verifyLivenessThreshold({
        ciphertext: "encrypted-data",
        keyId: "key-id",
      });
      expect(capturedBody.threshold).toBe(0.3);
    });

    it("should verify threshold successfully", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue(
          msgpackResponse({
            passesCiphertext: "encrypted-result",
            threshold: 0.5,
          }),
        ),
      );

      const caller = createCaller(authedSession);
      const data = await caller.verifyLivenessThreshold({
        ciphertext: "encrypted-data",
        threshold: 0.5,
        keyId: "key-id",
      });

      expect(data.passesCiphertext).toBe("encrypted-result");
      expect(data.threshold).toBe(0.5);
    });

    it("should return false when threshold not met", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue(
          msgpackResponse({
            passesCiphertext: "encrypted-result",
            threshold: 0.9,
          }),
        ),
      );

      const caller = createCaller(authedSession);
      const data = await caller.verifyLivenessThreshold({
        ciphertext: "encrypted-data",
        threshold: 0.9,
        keyId: "key-id",
      });
      expect(data.passesCiphertext).toBe("encrypted-result");
    });
  });
});
