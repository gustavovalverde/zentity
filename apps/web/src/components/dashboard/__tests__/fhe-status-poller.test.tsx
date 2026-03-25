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

import { FheStatusPoller } from "../fhe-status-poller";

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

  it("keeps polling past the old attempt cap while work is still pending", async () => {
    trpcMocks.profileQueryMock.mockResolvedValue({
      assurance: {
        tier: 1,
        details: { fheComplete: false, missingProfileSecret: false },
      },
    });

    render(<FheStatusPoller />);

    await act(async () => {
      await flushAsyncWork();
    });
    expect(trpcMocks.profileQueryMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 25; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
        await flushAsyncWork();
      });
    }

    expect(trpcMocks.profileQueryMock.mock.calls.length).toBeGreaterThan(20);
    expect(navigationMocks.replaceMock).not.toHaveBeenCalled();
    expect(navigationMocks.refreshMock).not.toHaveBeenCalled();
  });
});
