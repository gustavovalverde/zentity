import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createKeyedTtlCache,
  createTtlCache,
  createValidatedTtlCache,
} from "../ttl-cache";

describe("createTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves a value", () => {
    const cache = createTtlCache<string>(1000);
    cache.set("test-value");
    expect(cache.get()).toBe("test-value");
  });

  it("returns null when empty", () => {
    const cache = createTtlCache<string>(1000);
    expect(cache.get()).toBeNull();
  });

  it("expires after TTL", () => {
    const cache = createTtlCache<string>(1000);
    cache.set("test-value");

    vi.advanceTimersByTime(999);
    expect(cache.get()).toBe("test-value");

    vi.advanceTimersByTime(2);
    expect(cache.get()).toBeNull();
  });

  it("clears the cache", () => {
    const cache = createTtlCache<string>(1000);
    cache.set("test-value");
    cache.clear();
    expect(cache.get()).toBeNull();
  });

  it("has() returns true for valid entry", () => {
    const cache = createTtlCache<string>(1000);
    cache.set("test-value");
    expect(cache.has()).toBe(true);
  });

  it("has() returns false for expired entry", () => {
    const cache = createTtlCache<string>(1000);
    cache.set("test-value");
    vi.advanceTimersByTime(1001);
    expect(cache.has()).toBe(false);
  });

  it("getRaw() returns entry without TTL check", () => {
    const cache = createTtlCache<string>(1000);
    cache.set("test-value");
    vi.advanceTimersByTime(2000);

    // get() returns null (expired)
    const raw = cache.getRaw();
    expect(raw).not.toBeNull();
    expect(raw?.value).toBe("test-value");
  });
});

describe("createValidatedTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  interface UserData {
    userId: string;
    data: string;
  }

  it("validates against key on get", () => {
    const cache = createValidatedTtlCache<UserData, string>(
      1000,
      (entry, userId) => entry.userId === userId
    );

    cache.set({ userId: "user-1", data: "secret" });

    expect(cache.get("user-1")?.data).toBe("secret");
    expect(cache.get("user-2")).toBeNull();
  });

  it("expires after TTL", () => {
    const cache = createValidatedTtlCache<UserData, string>(
      1000,
      (entry, userId) => entry.userId === userId
    );

    cache.set({ userId: "user-1", data: "secret" });
    vi.advanceTimersByTime(1001);
    expect(cache.get("user-1")).toBeNull();
  });

  it("has() validates correctly", () => {
    const cache = createValidatedTtlCache<UserData, string>(
      1000,
      (entry, userId) => entry.userId === userId
    );

    cache.set({ userId: "user-1", data: "secret" });
    expect(cache.has("user-1")).toBe(true);
    expect(cache.has("user-2")).toBe(false);
  });
});

describe("createKeyedTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values by key", () => {
    const cache = createKeyedTtlCache<string>(1000);
    cache.set("key-1", "value-1");
    cache.set("key-2", "value-2");

    expect(cache.get("key-1")).toBe("value-1");
    expect(cache.get("key-2")).toBe("value-2");
  });

  it("returns null for missing key", () => {
    const cache = createKeyedTtlCache<string>(1000);
    expect(cache.get("missing")).toBeNull();
  });

  it("expires entries after TTL", () => {
    const cache = createKeyedTtlCache<string>(1000);
    cache.set("key-1", "value-1");

    vi.advanceTimersByTime(500);
    cache.set("key-2", "value-2");

    vi.advanceTimersByTime(600);
    expect(cache.get("key-1")).toBeNull(); // expired
    expect(cache.get("key-2")).toBe("value-2"); // still valid
  });

  it("deletes specific keys", () => {
    const cache = createKeyedTtlCache<string>(1000);
    cache.set("key-1", "value-1");
    cache.delete("key-1");
    expect(cache.get("key-1")).toBeNull();
  });

  it("clears all entries", () => {
    const cache = createKeyedTtlCache<string>(1000);
    cache.set("key-1", "value-1");
    cache.set("key-2", "value-2");
    cache.clear();
    expect(cache.get("key-1")).toBeNull();
    expect(cache.get("key-2")).toBeNull();
  });

  it("has() returns correct state", () => {
    const cache = createKeyedTtlCache<string>(1000);
    cache.set("key-1", "value-1");
    expect(cache.has("key-1")).toBe(true);
    expect(cache.has("missing")).toBe(false);
  });
});
