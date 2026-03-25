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

vi.mock("@/components/vault-unlock/use-vault-unlock", () => ({
  fetchIntentFromEndpoint: vi.fn(),
  useVaultUnlock: () => vaultMocks,
}));

vi.mock("@/components/vault-unlock/vault-unlock-panel", () => ({
  VaultUnlockPanel: () => <div>Vault ready</div>,
}));

import { CibaApproveClient } from "./ciba-approve-client";

describe("CibaApproveClient", () => {
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

        if (url === "/api/auth/ciba/authorize") {
          return Promise.resolve(new Response(null, { status: 200 }));
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  it("warns about missing fields but still allows partial profile disclosure", async () => {
    render(
      <CibaApproveClient
        authMode="passkey"
        authReqId="req-1"
        initialRequest={{
          auth_req_id: "req-1",
          client_name: "Zentity",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          scope: "openid identity.name identity.address identity.dob",
          status: "pending",
        }}
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
      "/api/auth/ciba/reject",
      expect.anything()
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/ciba/authorize",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(screen.getByText("Request Approved")).toBeTruthy();
  });
});
