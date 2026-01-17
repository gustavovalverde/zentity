import { encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/utils", () => ({
  HttpError: class HttpError extends Error {},
}));

vi.mock("@/lib/utils/service-urls", () => ({
  getFheServiceUrl: () => "http://fhe.local",
}));

import { encryptBirthYearOffsetFhe } from "../fhe-client";

describe("fhe-client request logging", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    const encoded = encode({
      birthYearOffsetCiphertext: new Uint8Array([1, 2, 3]),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      arrayBuffer: async () =>
        encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength
        ),
      text: async () => "",
    });
  });

  it("propagates request id header to FHE service", async () => {
    await encryptBirthYearOffsetFhe({
      birthYearOffset: 1,
      keyId: "key-123",
      requestId: "req-123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://fhe.local/encrypt-batch",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Request-Id": "req-123",
        }),
      })
    );
  });
});
