import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDbRun = vi.fn();

vi.mock("@/lib/db/connection", () => ({
  db: { run: (...args: unknown[]) => mockDbRun(...args) },
}));

// Ensure drizzle-orm sql tag is available even if a prior vmThread file
// replaced the module cache with an incomplete mock.
vi.mock("drizzle-orm", async (importOriginal) => importOriginal());

import { GET } from "../route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns healthy when DB responds", async () => {
    mockDbRun.mockResolvedValue(undefined);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.db).toBe("ok");
  });

  it("returns degraded when DB throws", async () => {
    mockDbRun.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.db).toBe("unreachable");
  });

  it("returns degraded when DB hangs past timeout", async () => {
    mockDbRun.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        })
    );

    const promise = GET();
    vi.advanceTimersByTime(2000);
    const res = await promise;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.db).toBe("unreachable");
  });

  it("sets cache-control: no-store", async () => {
    mockDbRun.mockResolvedValue(undefined);

    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
