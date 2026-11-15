import { describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

import { sanitizeLogMessage } from "../redact";

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

  it.each([
    ["Contact a.b+tag@mail.example.co today", "Contact [redacted-email] today"],
    ["(alice@example.org)", "([redacted-email])"],
    ["a@b.com-x and c_d%e@f-g.h.i", "[redacted-email] and [redacted-email]"],
    ["a@b@c.com", "a@[redacted-email]"],
    ["Write to ops@example.com.", "Write to [redacted-email]."],
  ])("redacts the email in %j", (input, expected) => {
    expect(sanitizeLogMessage(input)).toBe(expected);
  });

  it.each(["user@localhost", "a@.example.com", "a@b..com", "@example.com"])(
    "leaves %j, which is not an email address",
    (input) => {
      expect(sanitizeLogMessage(input)).toBe(input);
    }
  );

  it("scans long input without an @ in linear time", () => {
    const start = performance.now();
    sanitizeLogMessage("a".repeat(200_000));
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("redacts base64 image data", () => {
    const output = sanitizeLogMessage("data:image/png;base64,abcdef");
    expect(output).toBe("[base64-image]");
  });
});
