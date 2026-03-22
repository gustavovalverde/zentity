// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const REVOKE_SESSION_LABEL = /revoke session/i;

const trpcMocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutateAsync: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useUtils: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpcReact: {
    agent: {
      listHosts: {
        useQuery: trpcMocks.useQuery,
      },
      revokeSession: {
        useMutation: trpcMocks.useMutation,
      },
    },
    useUtils: trpcMocks.useUtils,
  },
}));

import { AgentsDashboardClient } from "./agents-dashboard-client";

describe("AgentsDashboardClient", () => {
  it("renders hosts grouped around sessions and revokes through tRPC", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() => {
      throw new Error("fetch should not be called");
    });

    trpcMocks.invalidate.mockResolvedValue(undefined);
    trpcMocks.useUtils.mockReturnValue({
      agent: {
        listHosts: {
          invalidate: trpcMocks.invalidate,
        },
      },
    });
    trpcMocks.useQuery.mockReturnValue({
      data: [
        {
          attestationProvider: "AgentPass",
          attestationTier: "attested",
          createdAt: new Date().toISOString(),
          id: "host-1",
          name: "Laptop",
          publicKeyThumbprint: "1234567890abcdef1234567890abcdef",
          sessionCount: 1,
          sessions: [
            {
              createdAt: new Date().toISOString(),
              displayName: "Claude Code",
              grants: [
                {
                  capabilityName: "check_compliance",
                  constraints: [{ field: "region", op: "eq", value: "EU" }],
                  grantedAt: new Date().toISOString(),
                  hostPolicyId: null,
                  id: "grant-1",
                  source: "host_policy",
                  status: "active",
                },
              ],
              hostId: "host-1",
              id: "session-1",
              idleExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              idleTtlSec: 1800,
              lastActiveAt: new Date().toISOString(),
              lifecycle: {
                createdAt: new Date().toISOString(),
                idleExpiresAt: new Date(Date.now() + 60_000).toISOString(),
                idleTtlSec: 1800,
                lastActiveAt: new Date().toISOString(),
                maxExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
                maxLifetimeSec: 86_400,
                status: "active",
              },
              maxExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              maxLifetimeSec: 86_400,
              model: "claude",
              runtime: "node",
              status: "active",
              usageToday: 2,
              version: "1.2.3",
            },
          ],
          status: "active",
          updatedAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
    });
    trpcMocks.useMutation.mockImplementation(
      (options?: { onSuccess?: () => Promise<void> | void }) => {
        trpcMocks.mutateAsync.mockImplementation(async (input) => {
          await options?.onSuccess?.();
          return { revoked: true, ...input };
        });
        return {
          mutateAsync: trpcMocks.mutateAsync,
        };
      }
    );

    render(<AgentsDashboardClient />);

    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("check_compliance")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: REVOKE_SESSION_LABEL }));

    await waitFor(() => {
      expect(trpcMocks.mutateAsync).toHaveBeenCalledWith({
        sessionId: "session-1",
      });
      expect(trpcMocks.invalidate).toHaveBeenCalled();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
