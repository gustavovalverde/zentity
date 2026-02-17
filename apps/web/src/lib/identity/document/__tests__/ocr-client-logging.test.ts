import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

const fetchJson = vi.fn();

vi.mock("@/lib/utils/http", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  HttpError: class HttpError extends Error {},
}));

vi.mock("@/lib/utils/service-urls", () => ({
  getOcrServiceUrl: () => "http://ocr.local",
}));

import { processDocumentOcr } from "../ocr-client";

describe("ocr-client request logging", () => {
  beforeEach(() => {
    fetchJson.mockReset();
    fetchJson.mockResolvedValue({ documentType: "unknown", confidence: 0 });
  });

  it("propagates request id header to OCR service", async () => {
    await processDocumentOcr({
      image: "base64",
      requestId: "req-456",
    });

    expect(fetchJson).toHaveBeenCalledWith(
      "http://ocr.local/process",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Request-Id": "req-456",
        }),
      })
    );
  });

  it("sends image only in JSON body and never in headers", async () => {
    await processDocumentOcr({
      image: "sensitive-base64-pii-data",
      userSalt: "session-salt",
    });

    const requestOptions = fetchJson.mock.calls[0]?.[1] as {
      headers?: Record<string, string>;
      body?: string;
    };
    const requestBody = JSON.parse(requestOptions.body ?? "{}") as {
      image?: string;
      userSalt?: string;
    };

    expect(requestBody.image).toBe("sensitive-base64-pii-data");
    expect(requestBody.userSalt).toBe("session-salt");
    expect(requestOptions.headers).not.toHaveProperty("image");
  });

  it("rejects oversized image payloads before making a network call", async () => {
    await expect(
      processDocumentOcr({
        image: "x".repeat(16_000_001),
      })
    ).rejects.toThrow("Image payload too large for OCR processing");

    expect(fetchJson).not.toHaveBeenCalled();
  });
});
