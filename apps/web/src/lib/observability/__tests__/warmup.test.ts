import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const WARMUP_KEY = Symbol.for("zentity.warmup-complete");

describe("warmup flag", () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[WARMUP_KEY];
    vi.resetModules();
  });

  it("is visible to a separately loaded copy of the module", async () => {
    const instrumentationCopy = await import("../warmup");
    vi.resetModules();
    const routeCopy = await import("../warmup");

    expect(routeCopy).not.toBe(instrumentationCopy);
    expect(routeCopy.isWarmupComplete()).toBe(false);

    instrumentationCopy.markWarmupComplete();

    expect(routeCopy.isWarmupComplete()).toBe(true);
  });
});
