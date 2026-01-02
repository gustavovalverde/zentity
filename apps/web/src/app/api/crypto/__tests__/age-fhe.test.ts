/**
 * Tests for age FHE operations via tRPC.
 */

import type { Session } from "@/lib/auth/auth";

import { gzipSync } from "node:zlib";

import { encode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cryptoRouter } from "@/lib/trpc/routers/crypto";

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

function buildMsgpackResponse(
  payload: unknown,
  init: { status?: number; statusText?: string } = {},
  options: { gzip?: boolean; gzipHeaderOnly?: boolean } = {}
) {
  const encoded = encode(payload);
  const raw = Buffer.from(encoded);
  const useGzip = options.gzip ?? true;

  let body: Buffer;
  if (options.gzipHeaderOnly) {
    body = raw;
  } else if (useGzip) {
    body = gzipSync(raw);
  } else {
    body = raw;
  }

  const contentEncoding = options.gzipHeaderOnly || useGzip ? "gzip" : null;
  const arrayBuffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength
  );
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-encoding" ? contentEncoding : null,
    },
    arrayBuffer: () => Promise.resolve(arrayBuffer),
    text: () => Promise.resolve(""),
  };
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
        caller.registerFheKey({ serverKey: "server-key", publicKey: "pk" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("registers server key when authenticated", async () => {
      setFetchMock(
        vi.fn().mockResolvedValue(buildMsgpackResponse({ keyId: "key-123" }))
      );

      const caller = createCaller(authedSession);
      const response = await caller.registerFheKey({
        serverKey: "server-key",
        publicKey: "pk",
      });

      expect(response.keyId).toBe("key-123");
    });

    it("handles auto-decompressed gzip responses", async () => {
      setFetchMock(
        vi
          .fn()
          .mockResolvedValue(
            buildMsgpackResponse(
              { keyId: "key-456" },
              {},
              { gzipHeaderOnly: true }
            )
          )
      );

      const caller = createCaller(authedSession);
      const response = await caller.registerFheKey({
        serverKey: "server-key",
        publicKey: "pk",
      });

      expect(response.keyId).toBe("key-456");
    });
  });

  describe("verifyAgeFhe", () => {
    it("should throw BAD_REQUEST when keyId is missing", async () => {
      const caller = createCaller(null);
      await expect(
        caller.verifyAgeFhe({ ciphertext: "ciphertext" } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("returns encrypted result ciphertext", async () => {
      setFetchMock(
        vi
          .fn()
          .mockResolvedValue(
            buildMsgpackResponse({ resultCiphertext: "encrypted-result" })
          )
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
