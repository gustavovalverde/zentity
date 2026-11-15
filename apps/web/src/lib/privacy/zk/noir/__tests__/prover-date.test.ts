import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../worker-manager", () => ({}));

import { getTodayAsInt } from "../prover";

const originalTz = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("getTodayAsInt", () => {
  it("returns the UTC date regardless of the local time zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-12T23:30:00Z"));

    // Pacific/Auckland is already on the 13th at this instant, Pacific/Pago_Pago is still on the 12th.
    for (const tz of ["Pacific/Auckland", "Pacific/Pago_Pago", "UTC"]) {
      process.env.TZ = tz;
      expect(getTodayAsInt()).toBe(20_251_212);
    }
  });

  it("rolls over at UTC midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    process.env.TZ = "America/Los_Angeles";
    expect(getTodayAsInt()).toBe(20_260_101);
  });
});
