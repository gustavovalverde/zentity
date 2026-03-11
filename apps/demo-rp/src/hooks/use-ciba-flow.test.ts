import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyPollResponse, useCibaFlow } from "./use-ciba-flow";

// ─── classifyPollResponse (pure function) ───────────────────────────

describe("classifyPollResponse", () => {
  it("returns tokens on 200 with access_token", () => {
    const result = classifyPollResponse(200, { access_token: "tok_123" });
    expect(result).toEqual({
      kind: "tokens",
      tokens: { access_token: "tok_123" },
    });
  });

  it("returns pending on authorization_pending", () => {
    const result = classifyPollResponse(400, {
      error: "authorization_pending",
    });
    expect(result).toEqual({ kind: "pending" });
  });

  it("returns slow_down on slow_down", () => {
    const result = classifyPollResponse(400, { error: "slow_down" });
    expect(result).toEqual({ kind: "slow_down" });
  });

  it("returns terminal denied on access_denied", () => {
    const result = classifyPollResponse(403, { error: "access_denied" });
    expect(result).toEqual({ kind: "terminal", state: "denied" });
  });

  it("returns terminal expired on expired_token", () => {
    const result = classifyPollResponse(400, { error: "expired_token" });
    expect(result).toEqual({ kind: "terminal", state: "expired" });
  });

  it("returns terminal error on invalid_grant", () => {
    const result = classifyPollResponse(400, {
      error: "invalid_grant",
      error_description: "Auth request consumed",
    });
    expect(result).toEqual({
      kind: "terminal",
      state: "error",
      message: "Auth request consumed",
    });
  });

  it("returns terminal error with default message on unknown error", () => {
    const result = classifyPollResponse(500, { error: "server_error" });
    expect(result).toEqual({
      kind: "terminal",
      state: "error",
      message: "Token request failed",
    });
  });
});

// ─── useCibaFlow hook (state machine) ───────────────────────────────

function mockResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useCibaFlow state machine", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("transitions idle → polling → approved", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        mockResponse(200, { auth_req_id: "req_1", interval: 5 })
      )
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: "at_1", token_type: "Bearer" })
      )
      .mockResolvedValueOnce(mockResponse(200, { received: false }))
      .mockResolvedValueOnce(mockResponse(200, {}));

    const { result } = renderHook(() => useCibaFlow("test-provider"));
    expect(result.current.state).toBe("idle");

    // startFlow triggers authorize fetch, then pollToken fires fetchTokens immediately
    await act(async () => {
      await result.current.startFlow({
        loginHint: "user@test.com",
        scope: "openid",
      });
    });

    // Flush microtasks from the fire-and-forget fetchTokens promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.state).toBe("approved");
    expect(result.current.tokens).toEqual({
      access_token: "at_1",
      token_type: "Bearer",
    });
  });

  it("inflight guard prevents overlapping fetch calls", async () => {
    const tokenDeferred = createDeferred<ReturnType<typeof mockResponse>>();
    let tokenFetchCount = 0;

    fetchSpy.mockImplementation((_url: string, init?: { body?: string }) => {
      const body = init?.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

      if (body.action === "authorize") {
        return Promise.resolve(
          mockResponse(200, { auth_req_id: "req_dup", interval: 1 })
        );
      }

      if (body.action === "token") {
        tokenFetchCount++;
        return tokenDeferred.promise;
      }

      if (body.action === "check-ping") {
        return Promise.resolve(mockResponse(200, { received: false }));
      }

      return Promise.resolve(mockResponse(404, {}));
    });

    const { result } = renderHook(() => useCibaFlow("test-provider"));

    await act(async () => {
      await result.current.startFlow({
        loginHint: "user@test.com",
        scope: "openid",
      });
    });

    // Immediate fetchTokens started (tokenFetchCount = 1, deferred hangs)
    // Advance past the 1s interval so the timer fires again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // The inflight guard should have prevented a second fetch
    expect(tokenFetchCount).toBe(1);

    // Resolve and clean up
    await act(async () => {
      tokenDeferred.resolve(
        mockResponse(200, { access_token: "at_dup", token_type: "Bearer" })
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.state).toBe("approved");
  });

  it("after approved, no further poll results can regress state", async () => {
    let tokenCallCount = 0;

    fetchSpy.mockImplementation((_url: string, init?: { body?: string }) => {
      const body = init?.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

      if (body.action === "authorize") {
        return Promise.resolve(
          mockResponse(200, { auth_req_id: "req_stable", interval: 2 })
        );
      }

      if (body.action === "token") {
        tokenCallCount++;
        if (tokenCallCount === 1) {
          return Promise.resolve(
            mockResponse(400, { error: "authorization_pending" })
          );
        }
        return Promise.resolve(
          mockResponse(200, {
            access_token: "at_stable",
            token_type: "Bearer",
          })
        );
      }

      if (body.action === "check-ping") {
        return Promise.resolve(mockResponse(200, { received: false }));
      }

      if (body.action === "token-exchange") {
        return Promise.resolve(mockResponse(200, {}));
      }

      return Promise.resolve(mockResponse(404, {}));
    });

    const { result } = renderHook(() => useCibaFlow("test-provider"));

    await act(async () => {
      await result.current.startFlow({
        loginHint: "user@test.com",
        scope: "openid",
      });
    });

    // Flush immediate fetchTokens (returns authorization_pending)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("polling");

    // Advance to next poll interval (2s) — returns tokens → approved
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(result.current.state).toBe("approved");

    const fetchCountAtApproval = tokenCallCount;

    // Advance 10 minutes — well past all intervals and expire timeout
    // Intervals should be cleared, terminalRef blocks any stray callbacks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    // State must not regress, no additional token fetches should have occurred
    expect(result.current.state).toBe("approved");
    expect(tokenCallCount).toBe(fetchCountAtApproval);
  });
});
