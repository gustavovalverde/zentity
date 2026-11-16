import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trpc } from "@/lib/trpc/client";

const TRPC_REQUEST_TIMEOUT_MS = 60_000;

let fetchSignal: AbortSignal | undefined;

function hangUntilAborted(
  _url: unknown,
  init?: RequestInit
): Promise<Response> {
  fetchSignal = init?.signal ?? undefined;
  return new Promise((_resolve, reject) => {
    fetchSignal?.addEventListener("abort", () => reject(fetchSignal?.reason), {
      once: true,
    });
  });
}

describe("tRPC client request signal", () => {
  beforeEach(() => {
    fetchSignal = undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(hangUntilAborted);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts the request when the request timeout fires", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);

    const pending = trpc.zk.health.query();
    const settled = expect(pending).rejects.toBeDefined();
    await vi.waitFor(() => expect(fetchSignal).toBeDefined());

    expect(timeoutSpy).toHaveBeenCalledWith(TRPC_REQUEST_TIMEOUT_MS);
    expect(fetchSignal?.aborted).toBe(false);

    timeout.abort(new DOMException("timed out", "TimeoutError"));
    await settled;

    expect(fetchSignal?.aborted).toBe(true);
    expect((fetchSignal?.reason as DOMException).name).toBe("TimeoutError");
  });

  it("aborts the request when the caller's signal aborts", async () => {
    const caller = new AbortController();

    const pending = trpc.zk.health.query(undefined, { signal: caller.signal });
    const settled = expect(pending).rejects.toBeDefined();
    await vi.waitFor(() => expect(fetchSignal).toBeDefined());

    expect(fetchSignal?.aborted).toBe(false);

    caller.abort(new DOMException("cancelled", "AbortError"));
    await settled;

    expect(fetchSignal?.aborted).toBe(true);
    expect((fetchSignal?.reason as DOMException).name).toBe("AbortError");
  });
});
