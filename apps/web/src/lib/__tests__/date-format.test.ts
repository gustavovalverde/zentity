import { describe, expect, it } from "vitest";

import { formatDate } from "../date-format";

describe("formatDate", () => {
  it("returns the fallback for empty values", () => {
    expect(formatDate(null, "Never")).toBe("Never");
    expect(formatDate(undefined, "Never")).toBe("Never");
    expect(formatDate("", "Never")).toBe("Never");
  });

  it("returns the fallback for invalid dates instead of 'Invalid Date'", () => {
    expect(formatDate("not-a-date", "Unknown")).toBe("Unknown");
    expect(formatDate(new Date(Number.NaN), "Unknown")).toBe("Unknown");
  });

  it("formats Date objects and ISO strings the same way", () => {
    const iso = "2026-03-15T12:00:00.000Z";
    const formatted = formatDate(new Date(iso), "Unknown");
    expect(formatted).toContain("2026");
    expect(formatDate(iso, "Unknown")).toBe(formatted);
  });

  it("reads SQLite timestamps as UTC", () => {
    expect(formatDate("2026-03-15 12:00:00", "Unknown")).toBe(
      formatDate("2026-03-15T12:00:00Z", "Unknown")
    );
  });
});
