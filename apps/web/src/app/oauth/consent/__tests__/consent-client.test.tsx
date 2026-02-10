// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appKitMocks = vi.hoisted(() => ({
  open: vi.fn(),
  address: undefined as string | undefined,
  isConnected: false,
}));

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: appKitMocks.open }),
  useAppKitAccount: () => ({
    address: appKitMocks.address,
    isConnected: appKitMocks.isConnected,
  }),
}));

const wagmiMocks = vi.hoisted(() => ({
  chainId: undefined as number | undefined,
  signTypedData: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useChainId: () => wagmiMocks.chainId,
  useSignTypedData: () => ({ mutateAsync: wagmiMocks.signTypedData }),
}));

const authClientMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  oauth2: {
    consent: vi.fn(),
  },
  opaque: {
    verifyPassword: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: authClientMocks,
}));

const oauthPostLoginMocks = vi.hoisted(() => ({
  getSignedOAuthQuery: vi.fn(),
}));

vi.mock("@/lib/auth/oauth-post-login", () => ({
  getSignedOAuthQuery: oauthPostLoginMocks.getSignedOAuthQuery,
}));

const profileMocks = vi.hoisted(() => ({
  getStoredProfile: vi.fn(),
  getStoredProfileWithCredential: vi.fn(),
  resetProfileSecretCache: vi.fn(),
}));

vi.mock("@/lib/privacy/secrets/profile", () => ({
  getStoredProfile: profileMocks.getStoredProfile,
  getStoredProfileWithCredential: profileMocks.getStoredProfileWithCredential,
  resetProfileSecretCache: profileMocks.resetProfileSecretCache,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { OAuthConsentClient } from "../consent-client";

const WALLET_NONDETERMINISTIC_TEXT =
  /wallet does not produce deterministic signatures/i;

describe("OAuthConsentClient identity hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    appKitMocks.address = undefined;
    appKitMocks.isConnected = false;

    wagmiMocks.chainId = undefined;
    wagmiMocks.signTypedData.mockReset();

    authClientMocks.getSession.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    oauthPostLoginMocks.getSignedOAuthQuery.mockReturnValue(
      "client_id=client-1&scope=openid%20identity.name&exp=9999999999&sig=test"
    );

    profileMocks.getStoredProfile.mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    profileMocks.getStoredProfileWithCredential.mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            intent_token: "intent-token",
            expires_at: Math.floor(Date.now() / 1000) + 120,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
  });

  it("keeps Allow disabled until fresh unlock and intent token are ready", async () => {
    render(
      <OAuthConsentClient
        authMode="passkey"
        clientId="client-1"
        clientMeta={{ name: "RP", icon: null, uri: null }}
        optionalScopes={[]}
        scopeParam="openid identity.name"
        wallet={null}
      />
    );

    const allowButton = screen.getByRole("button", { name: "Allow" });
    expect(allowButton.hasAttribute("disabled")).toBe(true);
    expect(profileMocks.resetProfileSecretCache).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));

    await waitFor(() => {
      expect(profileMocks.getStoredProfile).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/oauth2/identity/intent",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    await waitFor(() => {
      expect(allowButton.hasAttribute("disabled")).toBe(false);
    });
  });

  it("shows deterministic-wallet remediation when signatures mismatch", async () => {
    appKitMocks.address = "0xabc123";
    appKitMocks.isConnected = true;
    wagmiMocks.chainId = 1;
    wagmiMocks.signTypedData
      .mockResolvedValueOnce("0xdeadbeef")
      .mockResolvedValueOnce("0xbeefdead");

    render(
      <OAuthConsentClient
        authMode="wallet"
        clientId="client-1"
        clientMeta={{ name: "RP", icon: null, uri: null }}
        optionalScopes={[]}
        scopeParam="openid identity.name"
        wallet={{ address: "0xabc123", chainId: 1 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign with Wallet" }));

    await waitFor(() => {
      expect(screen.getByText(WALLET_NONDETERMINISTIC_TEXT)).toBeTruthy();
    });

    expect(profileMocks.getStoredProfileWithCredential).not.toHaveBeenCalled();
  });
});
