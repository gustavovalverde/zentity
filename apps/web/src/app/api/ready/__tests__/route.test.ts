import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDbRun = vi.fn();
const mockIsWarmupComplete = vi.fn<() => boolean>();

vi.mock("@/lib/db/connection", () => ({
  db: { run: (...args: unknown[]) => mockDbRun(...args) },
}));

vi.mock("@/lib/observability/warmup-state", () => ({
  isWarmupComplete: () => mockIsWarmupComplete(),
}));

import { GET } from "../route";

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsWarmupComplete.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ready when warmup complete and DB ok", async () => {
    mockDbRun.mockResolvedValue(undefined);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks.warmup).toBe("complete");
    expect(body.checks.db).toBe("ok");
  });

  it("returns not ready when warmup incomplete", async () => {
    mockIsWarmupComplete.mockReturnValue(false);
    mockDbRun.mockResolvedValue(undefined);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.warmup).toBe("in_progress");
  });

  it("returns not ready when DB unreachable", async () => {
    mockDbRun.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.db).toBe("unreachable");
  });

  it("returns not ready when DB hangs past timeout", async () => {
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

    expect(res.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.db).toBe("unreachable");
  });

  it("sets cache-control: no-store", async () => {
    mockDbRun.mockResolvedValue(undefined);

    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
