import { afterEach, describe, expect, it, vi } from "vitest";

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

  describe("SQLite timestamps", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
      vi.resetModules();
    });

    it("reads them as UTC regardless of the viewer's time zone", async () => {
      // 23:30 UTC is already the next calendar day at UTC+13, but the same day
      // when the zone-less string is wrongly read as local time.
      process.env.TZ = "Pacific/Auckland";
      vi.resetModules();
      const { formatDate: formatInAuckland } = await import("../date-format");

      expect(formatInAuckland("2026-03-15 23:30:00", "Unknown")).toBe(
        formatInAuckland("2026-03-15T23:30:00Z", "Unknown")
      );
      expect(formatInAuckland("2026-03-15 23:30:00", "Unknown")).toContain(
        "16"
      );
    });
  });
});
