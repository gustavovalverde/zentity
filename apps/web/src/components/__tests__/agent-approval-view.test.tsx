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
}));

const passkeyMocks = vi.hoisted(() => ({
  assertion: {
    id: "cred-1",
    rawId: "cred-1",
    type: "public-key",
    response: { authenticatorData: "a", clientDataJSON: "c", signature: "s" },
    clientExtensionResults: {},
  },
  assertPasskeyForApproval: vi.fn(),
  getStoredProfileWithPasskeyStepUp: vi.fn(),
}));

vi.mock("@/lib/auth/passkey/client", () => ({
  assertPasskeyForApproval: passkeyMocks.assertPasskeyForApproval,
}));

vi.mock("@/lib/privacy/secrets/profile", () => ({
  getStoredProfileWithPasskeyStepUp:
    passkeyMocks.getStoredProfileWithPasskeyStepUp,
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
  fetchIntentFromEndpoint: vi.fn(() =>
    Promise.resolve({ intent_token: "fresh-intent", expires_at: 0 })
  ),
  useVaultUnlock: ({ active }: { active: boolean }) => ({
    ...vaultMocks,
    vaultState: active
      ? { status: "loaded" as const }
      : { status: "idle" as const },
  }),
  VaultUnlockPanel: () => <div>Vault ready</div>,
}));

import type { CibaRequestDetails } from "@/lib/agents/approval-resolve";

import { AgentApprovalView } from "../agent-approval-view";
import { TrpcProvider } from "../providers/trpc-provider";

const DECISION_URL = "/api/auth/ciba/decision";
const OPTIONS_URL = "/api/auth/ciba/decision/options";
const PROFILE_URL_PREFIX = "/api/trpc/assurance.profile";

const VERIFICATION_WARNING = /Complete identity verification first/;

let profileTier = 1;

function decisionBody(
  decision: "approved" | "denied",
  extra: Record<string, unknown> = {}
) {
  return expect.objectContaining({
    method: "POST",
    body: JSON.stringify({
      request_id: "req-1",
      decision,
      channel: "page",
      ...extra,
    }),
  });
}

function renderView({
  authMode = "passkey",
  requirement,
  scope,
  userTier,
}: {
  authMode?: "opaque" | "passkey";
  requirement?: Partial<CibaRequestDetails>;
  scope: string;
  userTier?: 0 | 1 | 2 | 3;
}) {
  return render(
    <TrpcProvider>
      <AgentApprovalView
        authMode={authMode}
        initialRequest={{
          request_id: "req-1",
          client_name: "Zentity",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          scope,
          status: "pending",
          ...requirement,
        }}
        requestId="req-1"
        {...(userTier === undefined ? {} : { userTier })}
        wallet={null}
      />
    </TrpcProvider>
  );
}

describe("AgentApprovalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileTier = 1;

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

        if (url.startsWith(PROFILE_URL_PREFIX)) {
          return Promise.resolve(
            Response.json([
              { result: { data: { assurance: { tier: profileTier } } } },
            ])
          );
        }

        if (url === DECISION_URL) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }

        if (url === OPTIONS_URL) {
          return Promise.resolve(
            Response.json({ challenge: "Y2hhbGxlbmdl", rpId: "localhost" })
          );
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  it("warns about missing fields but still allows partial profile disclosure", async () => {
    renderView({ scope: "openid identity.name identity.address identity.dob" });

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

  it("refreshes the assurance tier from the server for proof scopes", async () => {
    profileTier = 2;
    renderView({ scope: "openid proof:age", userTier: 1 });

    await waitFor(() => {
      expect(screen.queryByText(VERIFICATION_WARNING)).toBeNull();
    });
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("keeps the verification warning while the server tier is below verified", async () => {
    renderView({ scope: "openid proof:age", userTier: 1 });

    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) =>
            String(url).startsWith(PROFILE_URL_PREFIX)
          )
      ).toBe(true);
    });
    expect(screen.getByText(VERIFICATION_WARNING)).toBeTruthy();
  });

  const userVerification = {
    approval_requirement: "user_verification",
    page_only: true,
    passkey_available: true,
  } as const;

  it("unlocks a passkey vault and confirms with one passkey assertion at Approve", async () => {
    passkeyMocks.getStoredProfileWithPasskeyStepUp.mockResolvedValue({
      assertion: passkeyMocks.assertion,
      profile: vaultMocks.profileRef.current,
    });
    renderView({
      scope: "openid identity.name",
      requirement: userVerification,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Approve with passkey" })
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        DECISION_URL,
        decisionBody("approved", { webauthn: passkeyMocks.assertion })
      );
    });
    expect(
      passkeyMocks.getStoredProfileWithPasskeyStepUp
    ).toHaveBeenCalledTimes(1);
    expect(passkeyMocks.assertPasskeyForApproval).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/api/ciba/identity/stage",
      expect.objectContaining({
        body: expect.stringContaining('"intent_token":"fresh-intent"'),
      })
    );
  });

  it("runs a standalone assertion when a password opened the vault", async () => {
    passkeyMocks.assertPasskeyForApproval.mockResolvedValue(
      passkeyMocks.assertion
    );
    renderView({
      authMode: "opaque",
      scope: "openid identity.name",
      requirement: userVerification,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Approve with passkey" })
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        DECISION_URL,
        decisionBody("approved", { webauthn: passkeyMocks.assertion })
      );
    });
    expect(
      passkeyMocks.getStoredProfileWithPasskeyStepUp
    ).not.toHaveBeenCalled();
  });

  it("asks a user without a passkey to add one and keeps Deny", () => {
    renderView({
      scope: "openid",
      requirement: { ...userVerification, passkey_available: false },
    });

    expect(
      screen.getByText("Add a passkey to approve this request.")
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add a passkey" }).getAttribute("href")
    ).toBe("/dashboard/settings");
    expect(
      (
        screen.getByRole("button", {
          name: "Approve with passkey",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("names every requested scope with the server's label", () => {
    renderView({
      scope: "openid compliance:read email",
      requirement: {
        approval_requirement: "session",
        scope_labels: [
          {
            scope: "compliance:read",
            label: "compliance status",
            inline: true,
          },
          { scope: "email", label: "email address", inline: false },
        ],
      },
    });

    const iconClass = (label: string) =>
      screen
        .getByText(label)
        .closest("li")
        ?.querySelector("svg")
        ?.getAttribute("class");
    expect(iconClass("compliance status")).toContain("text-success");
    expect(iconClass("email address")).toContain("text-warning");
  });

  it("records an approval opened from the email link", async () => {
    window.history.pushState({}, "", "/approve/req-1?via=email");
    try {
      renderView({ scope: "openid" });

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          DECISION_URL,
          expect.objectContaining({
            body: JSON.stringify({
              request_id: "req-1",
              decision: "approved",
              channel: "email",
            }),
          })
        );
      });
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
});
