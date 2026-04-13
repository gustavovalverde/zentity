// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
}));

const trpcMocks = vi.hoisted(() => ({
  profileQueryMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigationMocks.replaceMock,
    refresh: navigationMocks.refreshMock,
  }),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    assurance: {
      profile: {
        query: trpcMocks.profileQueryMock,
      },
    },
  },
}));

import { FheStatusPoller } from "../fhe-lifecycle";

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("FheStatusPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigationMocks.replaceMock.mockReset();
    navigationMocks.refreshMock.mockReset();
    trpcMocks.profileQueryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("navigates to the dashboard when verification completes", async () => {
    trpcMocks.profileQueryMock
      .mockResolvedValueOnce({
        assurance: {
          tier: 1,
          details: { fheComplete: false, missingProfileSecret: false },
        },
      })
      .mockResolvedValueOnce({
        assurance: {
          tier: 2,
          details: { fheComplete: true, missingProfileSecret: false },
        },
      });

    render(<FheStatusPoller />);

    await act(async () => {
      await flushAsyncWork();
    });
    expect(trpcMocks.profileQueryMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await flushAsyncWork();
    });
    await act(async () => {
      await flushAsyncWork();
    });

    expect(navigationMocks.replaceMock).toHaveBeenCalledWith("/dashboard");
    expect(navigationMocks.refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes in place when verification completes but profile secret is missing", async () => {
    trpcMocks.profileQueryMock.mockResolvedValueOnce({
      assurance: {
        tier: 2,
        details: { fheComplete: true, missingProfileSecret: true },
      },
    });

    render(<FheStatusPoller />);

    await act(async () => {
      await flushAsyncWork();
    });
    expect(navigationMocks.refreshMock).toHaveBeenCalledTimes(1);
    expect(navigationMocks.replaceMock).not.toHaveBeenCalled();
  });

  it("stops polling when max attempts reached", async () => {
    let callCount = 0;
    trpcMocks.profileQueryMock.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        assurance: {
          tier: 1,
          details: { fheComplete: false, missingProfileSecret: false },
        },
      });
    });

    const { container } = render(<FheStatusPoller />);

    // Run polls one at a time until the mock stops being called
    for (let i = 0; i < 70; i++) {
      const prevCount = callCount;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100);
      });
      await act(async () => {
        await flushAsyncWork();
      });
      if (callCount === prevCount && callCount > 0) {
        break;
      }
    }

    // Should have polled at least 60 times before stopping
    expect(callCount).toBeGreaterThanOrEqual(60);
    expect(navigationMocks.replaceMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("taking longer than expected");
  }, 30_000);

  it("shows error and stops on network failure", async () => {
    trpcMocks.profileQueryMock.mockRejectedValue(new Error("fetch failed"));

    const { container } = render(<FheStatusPoller />);

    // Initial poll fires from useEffect, flush the rejection
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Network error");
    // Should not schedule more polls after error
    const callsBefore = trpcMocks.profileQueryMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(trpcMocks.profileQueryMock.mock.calls.length).toBe(callsBefore);
  });
});
