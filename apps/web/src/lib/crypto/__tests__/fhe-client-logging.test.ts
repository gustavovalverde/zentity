import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

const fetchJson = vi.fn();

vi.mock("@/lib/utils", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  HttpError: class HttpError extends Error {},
}));

vi.mock("@/lib/utils/service-urls", () => ({
  getFheServiceUrl: () => "http://fhe.local",
}));

import { encryptBirthYearOffsetFhe } from "../fhe-client";

describe("fhe-client request logging", () => {
  beforeEach(() => {
    fetchJson.mockReset();
    fetchJson.mockResolvedValue({ ciphertext: "cipher" });
  });

  it("propagates request id header to FHE service", async () => {
    await encryptBirthYearOffsetFhe({
      birthYearOffset: 1,
      publicKey: "public",
      requestId: "req-123",
    });

    expect(fetchJson).toHaveBeenCalledWith(
      "http://fhe.local/encrypt-birth-year-offset",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Request-Id": "req-123",
        }),
      }),
    );
  });
});
