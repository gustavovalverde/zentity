// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const TOGGLE_DETAILS_RE = /toggle details/i;
const REVOKE_ACCESS_RE = /revoke access/i;
const REVOKE_ACCESS_EXACT_RE = /^Revoke access$/;
const APPROVE_RE = /^Approve$/;
const DEFAULT_RE = /Default/;
const REQUESTED_RE = /Requested/;
const REGION_EU_RE = /region is EU/;
const REVOKE_CONFIRM_RE = /Revoke access for Claude Code/;
const REQUESTED_CLAUDE_RE = /Requested · Claude Code/;
const DEFAULT_CURSOR_RE = /Default · Cursor · region is EU/;

const trpcMocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutateAsyncRevoke: vi.fn(),
  mutateAsyncGrant: vi.fn(),
  useMutationRevoke: vi.fn(),
  useMutationGrant: vi.fn(),
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
        useMutation: trpcMocks.useMutationRevoke,
      },
      updateGrant: {
        useMutation: trpcMocks.useMutationGrant,
      },
    },
    useUtils: trpcMocks.useUtils,
  },
}));

import { ConnectedTab } from "./connected-tab";

function setupMocks() {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockImplementation(() => {
    throw new Error("fetch should not be called");
  });

  trpcMocks.invalidate.mockResolvedValue(undefined);
  trpcMocks.useUtils.mockReturnValue({
    agent: {
      listHosts: { invalidate: trpcMocks.invalidate },
    },
  });

  trpcMocks.useMutationRevoke.mockImplementation(
    (options?: { onSuccess?: () => Promise<void> | void }) => {
      trpcMocks.mutateAsyncRevoke.mockImplementation(async (input) => {
        await options?.onSuccess?.();
        return { revoked: true, ...input };
      });
      return { mutateAsync: trpcMocks.mutateAsyncRevoke };
    }
  );

  trpcMocks.useMutationGrant.mockImplementation(
    (options?: { onSuccess?: () => Promise<void> | void }) => {
      trpcMocks.mutateAsyncGrant.mockImplementation(async (input) => {
        await options?.onSuccess?.();
        return { updated: true, ...input };
      });
      return { mutateAsync: trpcMocks.mutateAsyncGrant };
    }
  );

  return fetchSpy;
}

const HOST_DATA = [
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
          {
            capabilityName: "my_profile",
            constraints: null,
            grantedAt: null,
            hostPolicyId: null,
            id: "grant-2",
            source: "session_elevation",
            status: "pending",
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
];

const [BASE_HOST] = HOST_DATA;
if (!BASE_HOST) {
  throw new Error("Expected host fixture");
}

const [BASE_SESSION] = BASE_HOST.sessions;
if (!BASE_SESSION) {
  throw new Error("Expected session fixture");
}

const DUPLICATE_GRANT_HOST_DATA = [
  {
    ...BASE_HOST,
    sessions: [
      {
        ...BASE_SESSION,
        id: "session-1",
        displayName: "Claude Code",
        grants: [
          {
            capabilityName: "my_profile",
            constraints: null,
            grantedAt: null,
            hostPolicyId: null,
            id: "grant-a",
            source: "session_elevation",
            status: "pending",
          },
        ],
      },
      {
        ...BASE_SESSION,
        id: "session-2",
        displayName: "Cursor",
        grants: [
          {
            capabilityName: "my_profile",
            constraints: [{ field: "region", op: "eq", value: "EU" }],
            grantedAt: new Date().toISOString(),
            hostPolicyId: null,
            id: "grant-b",
            source: "host_policy",
            status: "active",
          },
        ],
      },
    ],
  },
];

describe("ConnectedTab", () => {
  it("shows empty state when no hosts exist", () => {
    setupMocks();
    trpcMocks.useQuery.mockReturnValue({ data: [], isLoading: false });

    render(<ConnectedTab />);

    expect(screen.getByText("No agents connected")).toBeTruthy();
  });

  it("renders host with human-readable labels and expands on click", async () => {
    const fetchSpy = setupMocks();
    trpcMocks.useQuery.mockReturnValue({
      data: HOST_DATA,
      isLoading: false,
    });

    render(<ConnectedTab />);

    // Level 1: host summary is visible
    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();

    // Level 2: permissions are hidden until expanded
    expect(screen.queryByText("Check verification status")).toBeNull();

    // Expand the collapsible
    const expandButton = screen.getByRole("button", {
      name: TOGGLE_DETAILS_RE,
    });
    fireEvent.click(expandButton);

    // Now human-readable labels should be visible
    await waitFor(() => {
      expect(screen.getByText("Check verification status")).toBeTruthy();
      expect(screen.getByText("Read personal information")).toBeTruthy();
    });

    // Source labels should be human-readable
    expect(screen.getByText(DEFAULT_RE)).toBeTruthy();
    expect(screen.getByText(REQUESTED_RE)).toBeTruthy();

    // Constraint should be in natural language
    expect(screen.getByText(REGION_EU_RE)).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it("revokes session through AlertDialog confirmation", async () => {
    const fetchSpy = setupMocks();
    trpcMocks.useQuery.mockReturnValue({
      data: HOST_DATA,
      isLoading: false,
    });

    render(<ConnectedTab />);

    // Expand to see sessions
    fireEvent.click(screen.getByRole("button", { name: TOGGLE_DETAILS_RE }));

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeTruthy();
    });

    // Click revoke — should open AlertDialog
    const revokeButton = screen.getByRole("button", {
      name: REVOKE_ACCESS_RE,
    });
    fireEvent.click(revokeButton);

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText(REVOKE_CONFIRM_RE)).toBeTruthy();
    });

    // Confirm revocation
    const confirmButton = screen.getByRole("button", {
      name: REVOKE_ACCESS_EXACT_RE,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(trpcMocks.mutateAsyncRevoke).toHaveBeenCalledWith({
        sessionId: "session-1",
      });
      expect(trpcMocks.invalidate).toHaveBeenCalled();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("approves pending grants via updateGrant", async () => {
    const fetchSpy = setupMocks();
    trpcMocks.useQuery.mockReturnValue({
      data: HOST_DATA,
      isLoading: false,
    });

    render(<ConnectedTab />);

    // Expand
    fireEvent.click(screen.getByRole("button", { name: TOGGLE_DETAILS_RE }));

    await waitFor(() => {
      expect(screen.getByText("Read personal information")).toBeTruthy();
    });

    // Approve the pending grant
    const approveButton = screen.getByRole("button", { name: APPROVE_RE });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(trpcMocks.mutateAsyncGrant).toHaveBeenCalledWith({
        grantId: "grant-2",
        status: "active",
      });
      expect(trpcMocks.invalidate).toHaveBeenCalled();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("renders separate rows for grants from different sessions", async () => {
    const fetchSpy = setupMocks();
    trpcMocks.useQuery.mockReturnValue({
      data: DUPLICATE_GRANT_HOST_DATA,
      isLoading: false,
    });

    render(<ConnectedTab />);

    fireEvent.click(screen.getByRole("button", { name: TOGGLE_DETAILS_RE }));

    await waitFor(() => {
      expect(screen.getAllByText("Read personal information")).toHaveLength(2);
    });

    expect(screen.getByText(REQUESTED_CLAUDE_RE)).toBeTruthy();
    expect(screen.getByText(DEFAULT_CURSOR_RE)).toBeTruthy();

    fetchSpy.mockRestore();
  });
});
