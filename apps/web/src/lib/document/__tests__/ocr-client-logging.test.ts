import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

const fetchJson = vi.fn();

vi.mock("@/lib/utils", () => ({
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
});
