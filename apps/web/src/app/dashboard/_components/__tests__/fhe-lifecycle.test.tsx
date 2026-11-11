// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface AssuranceProfile {
  assurance: {
    details: {
      fheComplete: boolean;
      missingProfileSecret: boolean;
    };
    tier: number;
  };
}

interface QueryResult {
  data: AssuranceProfile | undefined;
  dataUpdatedAt: number;
  status: "error" | "success";
}

interface RefetchIntervalQuery {
  state: {
    data?: AssuranceProfile;
    dataUpdateCount: number;
    status: "error" | "success";
  };
}

interface CapturedQueryOptions {
  refetchInterval?: (query: RefetchIntervalQuery) => false | number | undefined;
}

const NETWORK_ERROR_TEXT = /Network error/i;
const TIMEOUT_TEXT = /taking longer than expected/i;

const navigationMocks = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
}));

const queryMocks = vi.hoisted(() => ({
  dataUpdateCount: 0,
  getQueryStateMock: vi.fn(),
  profileQueryKey: [["assurance", "profile"], { type: "query" }],
  queryOptions: undefined as CapturedQueryOptions | undefined,
  queryResult: {
    data: undefined,
    dataUpdatedAt: 0,
    status: "success",
  } as QueryResult,
  resetMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigationMocks.replaceMock,
    refresh: navigationMocks.refreshMock,
  }),
}));

vi.mock("@tanstack/react-query", () => {
  const queryClient = {
    getQueryState: queryMocks.getQueryStateMock,
    resetQueries: queryMocks.resetMock,
  };
  return {
    useQuery: queryMocks.useQueryMock,
    useQueryClient: () => queryClient,
  };
});

vi.mock("@/lib/trpc/client", () => {
  const trpc = {
    assurance: {
      profile: {
        queryFilter: () => ({ queryKey: queryMocks.profileQueryKey }),
        queryKey: () => queryMocks.profileQueryKey,
        queryOptions: (_input: undefined, options: CapturedQueryOptions) => ({
          ...options,
          queryKey: queryMocks.profileQueryKey,
        }),
      },
    },
  };
  return { useTRPC: () => trpc };
});

import { FheStatusPoller } from "../fhe-lifecycle";

function makeProfile({
  fheComplete = false,
  missingProfileSecret = false,
  tier = 1,
}: Partial<AssuranceProfile["assurance"]["details"]> & {
  tier?: number;
} = {}): AssuranceProfile {
  return {
    assurance: {
      details: {
        fheComplete,
        missingProfileSecret,
      },
      tier,
    },
  };
}

function getRefetchInterval() {
  const refetchInterval = queryMocks.queryOptions?.refetchInterval;
  if (!refetchInterval) {
    throw new Error("refetchInterval was not captured");
  }
  return refetchInterval;
}

describe("FheStatusPoller", () => {
  beforeEach(() => {
    navigationMocks.replaceMock.mockReset();
    navigationMocks.refreshMock.mockReset();
    queryMocks.dataUpdateCount = 0;
    queryMocks.getQueryStateMock.mockReset();
    queryMocks.getQueryStateMock.mockImplementation(() => ({
      dataUpdateCount: queryMocks.dataUpdateCount,
    }));
    queryMocks.queryOptions = undefined;
    queryMocks.queryResult = {
      data: undefined,
      dataUpdatedAt: 0,
      status: "success",
    };
    queryMocks.resetMock.mockReset();
    queryMocks.resetMock.mockResolvedValue(undefined);
    queryMocks.useQueryMock.mockReset();
    queryMocks.useQueryMock.mockImplementation((options) => {
      queryMocks.queryOptions = options;
      return queryMocks.queryResult;
    });
  });

  it("navigates to the dashboard when verification completes", async () => {
    queryMocks.queryResult = {
      data: makeProfile({ fheComplete: true, tier: 2 }),
      dataUpdatedAt: Date.now(),
      status: "success",
    };

    render(<FheStatusPoller />);

    await waitFor(() => {
      expect(navigationMocks.replaceMock).toHaveBeenCalledWith("/dashboard");
    });
    expect(navigationMocks.refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes in place when verification completes but profile secret is missing", async () => {
    queryMocks.queryResult = {
      data: makeProfile({
        fheComplete: true,
        missingProfileSecret: true,
        tier: 2,
      }),
      dataUpdatedAt: Date.now(),
      status: "success",
    };

    render(<FheStatusPoller />);

    await waitFor(() => {
      expect(navigationMocks.refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(navigationMocks.replaceMock).not.toHaveBeenCalled();
  });

  it("stops polling when max attempts are reached", () => {
    const profile = makeProfile();
    queryMocks.dataUpdateCount = 60;
    queryMocks.queryResult = {
      data: profile,
      dataUpdatedAt: Date.now(),
      status: "success",
    };

    render(<FheStatusPoller />);

    expect(screen.getByText(TIMEOUT_TEXT)).toBeTruthy();
    expect(
      getRefetchInterval()({
        state: { data: profile, dataUpdateCount: 60, status: "success" },
      })
    ).toBe(false);
  });

  it("shows error and stops on network failure", () => {
    queryMocks.queryResult = {
      data: undefined,
      dataUpdatedAt: 0,
      status: "error",
    };

    render(<FheStatusPoller />);

    expect(screen.getByText(NETWORK_ERROR_TEXT)).toBeTruthy();
    expect(
      getRefetchInterval()({
        state: { dataUpdateCount: 0, status: "error" },
      })
    ).toBe(false);
  });

  it("uses the expected backoff policy", () => {
    const profile = makeProfile();
    queryMocks.queryResult = {
      data: profile,
      dataUpdatedAt: Date.now(),
      status: "success",
    };

    render(<FheStatusPoller />);

    const refetchInterval = getRefetchInterval();
    expect(
      refetchInterval({
        state: { data: profile, dataUpdateCount: 0, status: "success" },
      })
    ).toBe(2000);
    expect(
      refetchInterval({
        state: { data: profile, dataUpdateCount: 2, status: "success" },
      })
    ).toBe(4500);
    expect(
      refetchInterval({
        state: { data: profile, dataUpdateCount: 10, status: "success" },
      })
    ).toBe(8000);
  });

  it("resets the query and refreshes on retry", () => {
    queryMocks.queryResult = {
      data: undefined,
      dataUpdatedAt: 0,
      status: "error",
    };

    render(<FheStatusPoller />);
    queryMocks.resetMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(queryMocks.resetMock).toHaveBeenCalledTimes(1);
    expect(queryMocks.resetMock).toHaveBeenCalledWith({
      queryKey: queryMocks.profileQueryKey,
    });
    expect(navigationMocks.refreshMock).toHaveBeenCalledTimes(1);
  });
});
