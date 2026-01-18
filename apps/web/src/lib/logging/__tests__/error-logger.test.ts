import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

import { logError, logWarn } from "../error-logger";

/** Matches a 12-character lowercase hex fingerprint */
const FINGERPRINT_PATTERN = /^[a-f0-9]{12}$/;

describe("error logger", () => {
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    log.error.mockClear();
    log.warn.mockClear();
  });

  it("sanitizes error messages and stack traces", () => {
    const err = new Error("Contact test@example.com id 1234567");
    err.stack =
      "Error: Contact test@example.com id 1234567\n    at handler (src/app.ts:10:5)";

    const fingerprint = logError(
      err,
      { path: "identity.finalize" },
      log as any
    );

    expect(fingerprint).toMatch(FINGERPRINT_PATTERN);
    expect(log.error).toHaveBeenCalled();

    const payload = log.error.mock.calls[0][0] as Record<string, unknown>;
    const error = payload.error as { message?: string; stack?: string };

    expect(error.message).toContain("[redacted-email]");
    expect(error.message).toContain("[redacted-number]");
    expect(error.stack).toContain("[redacted-email]");
    expect(error.stack).toContain("[redacted-number]");
  });

  it("produces stable fingerprints for identical errors", () => {
    const err1 = new Error("Boom");
    err1.stack = "Error: Boom\n    at handler (src/app.ts:10:5)";
    const err2 = new Error("Boom");
    err2.stack = "Error: Boom\n    at handler (src/app.ts:10:5)";

    const fp1 = logError(err1, { path: "x" }, log as any);
    const fp2 = logError(err2, { path: "x" }, log as any);

    expect(fp1).toBe(fp2);
  });

  it("sanitizes warning messages", () => {
    logWarn("Email test@example.com", {}, log as any);
    expect(log.warn).toHaveBeenCalled();
    const message = log.warn.mock.calls[0][1] as string;
    expect(message).toContain("[redacted-email]");
  });
});
