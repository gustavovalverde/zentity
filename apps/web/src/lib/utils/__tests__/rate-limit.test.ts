import { afterEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter, getClientIp } from "../rate-limit";

describe("createRateLimiter", () => {
  const limiters: ReturnType<typeof createRateLimiter>[] = [];

  function create(max: number, windowMs = 60_000) {
    const limiter = createRateLimiter({ windowMs, max });
    limiters.push(limiter);
    return limiter;
  }

  afterEach(() => {
    for (const l of limiters) {
      l.destroy();
    }
    limiters.length = 0;
  });

  it("allows requests up to max", () => {
    const limiter = create(3);
    expect(limiter.check("a").limited).toBe(false);
    expect(limiter.check("a").limited).toBe(false);
    expect(limiter.check("a").limited).toBe(false);
  });

  it("rejects at max + 1", () => {
    const limiter = create(2);
    limiter.check("a");
    limiter.check("a");
    const result = limiter.check("a");
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("allows again after window expires", () => {
    vi.useFakeTimers();
    const limiter = create(1, 1000);
    limiter.check("a");
    expect(limiter.check("a").limited).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(limiter.check("a").limited).toBe(false);
    vi.useRealTimers();
  });

  it("tracks different keys independently", () => {
    const limiter = create(1);
    limiter.check("a");
    expect(limiter.check("a").limited).toBe(true);
    expect(limiter.check("b").limited).toBe(false);
  });

  it("cleanup removes stale entries", () => {
    vi.useFakeTimers();
    const limiter = create(10, 100);
    limiter.check("a");
    expect(limiter.size).toBe(1);

    // Advance past the window + cleanup interval
    vi.advanceTimersByTime(201);
    expect(limiter.size).toBe(0);
    vi.useRealTimers();
  });
});

describe("getClientIp", () => {
  it("extracts from x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(getClientIp(h)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp(h)).toBe("5.6.7.8");
  });

  it("returns unknown when no headers", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
