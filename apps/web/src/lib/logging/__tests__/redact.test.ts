import { describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

import { extractInputMeta, REDACT_KEYS, sanitizeLogMessage } from "../redact";

describe("logging redaction", () => {
  it("redacts common sensitive patterns in log messages", () => {
    const input = "user test@example.com id 1234567 key 0xabcdef1234567890 ok";
    const output = sanitizeLogMessage(input);

    expect(output).toContain("[redacted-email]");
    expect(output).toContain("[redacted-number]");
    expect(output).toContain("[redacted-hex]");
    expect(output).not.toContain("test@example.com");
    expect(output).not.toContain("1234567");
    expect(output).not.toContain("0xabcdef1234567890");
  });

  it("redacts base64 image data", () => {
    const output = sanitizeLogMessage("data:image/png;base64,abcdef");
    expect(output).toBe("[base64-image]");
  });

  it("extracts safe input metadata without leaking sensitive keys", () => {
    const input = { password: "secret", safe: "ok" };
    const meta = extractInputMeta(input);

    expect(meta.inputKeys).toEqual(["safe"]);
    expect(typeof meta.inputSize).toBe("number");
    expect(REDACT_KEYS.has("password")).toBe(true);
  });
});
