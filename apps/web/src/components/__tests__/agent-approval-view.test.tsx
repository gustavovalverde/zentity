// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const vaultMocks = vi.hoisted(() => ({
  clearIntent: vi.fn(),
  fetchIdentityIntent: vi.fn(),
  handleProfileLoaded: vi.fn(),
  handleVaultError: vi.fn(),
  hasValidIdentityIntent: true,
  identityIntent: {
    token: "intent-token",
    expiresAt: Math.floor(Date.now() / 1000) + 120,
    scopeKey: "identity.address identity.dob identity.name openid",
  },
  intentError: null as string | null,
  intentLoading: false,
  loadProfilePasskey: vi.fn(),
  profileRef: {
    current: {
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "1815-12-10",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  resetToGesture: vi.fn(),
  vaultState: { status: "loaded" as const },
}));

vi.mock("@/components/vault-unlock", () => ({
  buildIdentityPayload: vi.fn(() => ({
    firstName: "Ada",
    lastName: "Lovelace",
    dateOfBirth: "1815-12-10",
  })),
  buildScopeKey: vi.fn(
    () => "identity.address identity.dob identity.name openid"
  ),
  fetchIntentFromEndpoint: vi.fn(),
  useVaultUnlock: () => vaultMocks,
  VaultUnlockPanel: () => <div>Vault ready</div>,
}));

import { AgentApprovalView } from "../agent-approval-view";

const DECISION_URL = "/api/auth/ciba/decision";

function decisionBody(decision: "approved" | "denied") {
  return expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ request_id: "req-1", decision }),
  });
}

describe("AgentApprovalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url === "/api/ciba/identity/stage") {
          return Promise.resolve(
            new Response(JSON.stringify({ staged: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }

        if (url === DECISION_URL) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  it("warns about missing fields but still allows partial profile disclosure", async () => {
    render(
      <AgentApprovalView
        authMode="passkey"
        initialRequest={{
          request_id: "req-1",
          client_name: "Zentity",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          scope: "openid identity.name identity.address identity.dob",
          status: "pending",
        }}
        requestId="req-1"
        wallet={null}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Residential address"
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/ciba/identity/stage",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(fetch).not.toHaveBeenCalledWith(
      DECISION_URL,
      decisionBody("denied")
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        DECISION_URL,
        decisionBody("approved")
      );
    });

    expect(screen.getByText("Request Approved")).toBeTruthy();
  });
});
