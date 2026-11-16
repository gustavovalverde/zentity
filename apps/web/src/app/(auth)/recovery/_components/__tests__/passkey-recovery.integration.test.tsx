// @vitest-environment jsdom

import type { VaultAccess } from "@/lib/privacy/secrets/vault-access";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USE_PASSKEY_LABEL = /use a passkey after all/i;
const CREATE_PASSKEY_LABEL = /create new passkey/i;
const GO_TO_SETTINGS_LABEL = /go to settings/i;
const NOT_VERIFIED_MESSAGE = /didn't ask for your PIN, fingerprint, or face/i;
const UNLOCK_WITH_PASSWORD_LABEL = /unlock with password/i;
const USE_PASSWORD_LABEL = /use your password/i;
const OTHER_ACCOUNT_MESSAGE = /belongs to another Zentity account/i;
const REMOVE_LOST_HEADING = /remove passkeys you no longer have/i;
const NONE_OF_THESE_LABEL = /can't use any of these/i;
const START_OVER_LABEL = /start over with new keys/i;
const CONFIRM_WALLET_LABEL = /confirm with wallet/i;
const EMAIL_LINK_HELD = /you confirmed with an email link/i;
const SIGN_IN_AGAIN = /signing in with your wallet/i;

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => search.params,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const authMocks = vi.hoisted(() => ({
  magicLink: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    opaque: { verifyPassword: authMocks.verifyPassword },
    signIn: { magicLink: authMocks.magicLink },
  },
  useSession: () => ({
    data: { user: { id: "user-1", email: "owner@example.com" } },
    isPending: false,
  }),
}));

const passkeyMocks = vi.hoisted(() => ({
  deletePasskey: vi.fn(),
  proveRecoveryKey: vi.fn(),
  registerPasskeyWithPrf: vi.fn(),
  signInWithPasskey: vi.fn(),
  withPasskeyConfirmation: vi.fn(),
}));

vi.mock("@/lib/auth/passkey/client", () => passkeyMocks);

vi.mock("@/lib/auth/passkey/prf", () => ({
  checkPrfSupport: vi.fn().mockResolvedValue({ supported: true }),
  evaluatePrf: vi.fn(),
}));

const trpcMocks = vi.hoisted(() => ({
  access: vi.fn(),
  recoveryOptions: vi.fn(),
  resetVault: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    account: { recoveryOptions: { query: trpcMocks.recoveryOptions } },
    secrets: {
      access: { query: trpcMocks.access },
      resetVault: { mutate: trpcMocks.resetVault },
    },
  },
}));

const vaultMocks = vi.hoisted(() => ({
  addVaultCredential: vi.fn(),
  removePasskey: vi.fn(),
  unlockVaultKey: vi.fn(),
  verifyVaultCredential: vi.fn(),
}));

vi.mock("@/lib/privacy/secrets/vault", () => vaultMocks);

vi.mock("@/lib/privacy/zk/binding-context", () => ({
  registerCredentialBinding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/redirect", () => ({ redirectTo: vi.fn() }));

vi.mock("@/components/recovery-key-setup", () => ({
  RecoveryKeySetup: () => null,
}));

const unlockVaultKey = {
  key: new Uint8Array(32).fill(9),
  secretId: "secret-1",
  unlockedWith: "opaque",
  userId: "user-1",
};

const offeredPasskeys = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/components/vault-unlock", () => ({
  hasVaultUnlockMethod: (methods: {
    passkeyCredentialIds: string[];
    password: boolean;
  }) => methods.passkeyCredentialIds.length > 0 || methods.password,
  vaultUnlockMethods: (access: VaultAccess) => ({
    passkeyCredentialIds: access.passkeys
      .filter((passkey) => passkey.connected)
      .map((passkey) => passkey.credentialId),
    password: Boolean(access.password?.connected),
    recoveryKey: false,
    wallet: null,
  }),
  VaultUnlockOptions: ({
    methods,
    onUnlocked,
  }: {
    methods: { passkeyCredentialIds: string[] };
    onUnlocked: (vaultKey: typeof unlockVaultKey) => Promise<void>;
  }) => {
    offeredPasskeys.ids = methods.passkeyCredentialIds;
    return (
      <button onClick={() => onUnlocked(unlockVaultKey)} type="button">
        Unlock with password
      </button>
    );
  },
}));

vi.mock("@/components/wallet-confirmation-button", () => ({
  WalletConfirmationButton: ({
    onConfirmed,
  }: {
    onConfirmed: () => Promise<void> | void;
  }) => (
    <button onClick={() => onConfirmed()} type="button">
      Confirm with wallet
    </button>
  ),
}));

vi.mock("../remove-unrecognized-passkeys", () => ({
  RemoveUnrecognizedPasskeys: () => <p>Passkeys on your account</p>,
}));

import RecoverPasskeyPage from "../../passkey/page";
import { VaultRecovery } from "../vault-recovery";

function recoveryOptions(overrides: Record<string, unknown> = {}) {
  return {
    available: {
      email: true,
      password: true,
      recoveryKey: false,
      wallet: false,
    },
    enrollment: "reverification_required",
    hasPasskey: true,
    hasPassword: true,
    passkeyReverified: false,
    proofs: [],
    signedInWithPasskey: false,
    ...overrides,
  };
}

const workingPasskey = {
  connected: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  credentialId: "cred-working",
  id: "passkey-working",
  name: "Phone",
};

const access: VaultAccess = {
  passkeys: [workingPasskey],
  password: { connected: true },
  recoveryKey: null,
  secretId: "secret-1",
  unlockingCount: 2,
  wallet: null,
};

const newPasskey = {
  type: "passkey" as const,
  credentialId: "cred-new",
  prfOutput: new Uint8Array(32).fill(1),
  prfSalt: new Uint8Array(32).fill(2),
};

describe("lost passkey recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.params = new URLSearchParams();
    offeredPasskeys.ids = [];
    trpcMocks.access.mockResolvedValue(access);
    vaultMocks.addVaultCredential.mockResolvedValue(undefined);
    vaultMocks.removePasskey.mockResolvedValue({ error: null });
    vaultMocks.verifyVaultCredential.mockResolvedValue([]);
  });

  describe("the recovery page", () => {
    it("sends a user whose passkey confirmed it to Settings instead of replacing the passkey", async () => {
      trpcMocks.recoveryOptions
        .mockResolvedValueOnce(recoveryOptions())
        .mockResolvedValueOnce(
          recoveryOptions({
            enrollment: "allowed",
            passkeyReverified: true,
            signedInWithPasskey: true,
          })
        );
      passkeyMocks.signInWithPasskey.mockResolvedValue({
        ok: true,
        data: { user: { id: "user-1" } },
      });

      render(<RecoverPasskeyPage />);
      fireEvent.click(
        await screen.findByRole("button", { name: USE_PASSKEY_LABEL })
      );

      const settings = await screen.findByRole("link", {
        name: GO_TO_SETTINGS_LABEL,
      });
      expect(settings.getAttribute("href")).toBe("/dashboard/settings");
      expect(
        screen.queryByRole("button", { name: CREATE_PASSKEY_LABEL })
      ).toBeNull();
      expect(passkeyMocks.registerPasskeyWithPrf).not.toHaveBeenCalled();
      expect(vaultMocks.removePasskey).not.toHaveBeenCalled();
    });

    it("sends a session that recently signed in with a passkey to Settings", async () => {
      trpcMocks.recoveryOptions.mockResolvedValue(
        recoveryOptions({
          enrollment: "allowed",
          passkeyReverified: true,
          signedInWithPasskey: true,
        })
      );

      render(<RecoverPasskeyPage />);

      expect(
        await screen.findByRole("link", { name: GO_TO_SETTINGS_LABEL })
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: CREATE_PASSKEY_LABEL })
      ).toBeNull();
    });

    it("still lists passkeys for removal after a passkey confirmed it", async () => {
      search.params = new URLSearchParams("intent=remove");
      trpcMocks.recoveryOptions.mockResolvedValue(
        recoveryOptions({
          enrollment: "allowed",
          passkeyReverified: true,
          signedInWithPasskey: true,
        })
      );

      render(<RecoverPasskeyPage />);

      expect(await screen.findByText("Passkeys on your account")).toBeTruthy();
    });

    it("explains a passkey sign-in without user verification and asks for other proofs", async () => {
      trpcMocks.recoveryOptions
        .mockResolvedValueOnce(recoveryOptions())
        .mockResolvedValueOnce(recoveryOptions({ signedInWithPasskey: true }));
      passkeyMocks.signInWithPasskey.mockResolvedValue({
        ok: true,
        data: { user: { id: "user-1" } },
      });

      render(<RecoverPasskeyPage />);
      fireEvent.click(
        await screen.findByRole("button", { name: USE_PASSKEY_LABEL })
      );

      expect(await screen.findByText(NOT_VERIFIED_MESSAGE)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: USE_PASSWORD_LABEL })
      ).toBeTruthy();
      expect(
        screen.queryByRole("link", { name: GO_TO_SETTINGS_LABEL })
      ).toBeNull();
    });

    it("pairs an email link with a wallet confirmed in the same session", async () => {
      const afterEmailLink = recoveryOptions({
        available: {
          email: true,
          password: false,
          recoveryKey: false,
          wallet: true,
        },
        hasPassword: false,
        proofs: ["magic_link"],
      });
      trpcMocks.recoveryOptions
        .mockResolvedValueOnce(afterEmailLink)
        .mockResolvedValueOnce(
          recoveryOptions({
            enrollment: "allowed",
            proofs: ["magic_link", "wallet"],
          })
        );

      render(<RecoverPasskeyPage />);
      expect(await screen.findByText(EMAIL_LINK_HELD)).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: CONFIRM_WALLET_LABEL })
      );

      expect(
        await screen.findByRole("button", { name: CREATE_PASSKEY_LABEL })
      ).toBeTruthy();
      expect(screen.queryByText(SIGN_IN_AGAIN)).toBeNull();
      expect(authMocks.magicLink).not.toHaveBeenCalled();
    });

    it("refuses a passkey from another account", async () => {
      trpcMocks.recoveryOptions.mockResolvedValue(recoveryOptions());
      passkeyMocks.signInWithPasskey.mockResolvedValue({
        ok: true,
        data: { user: { id: "someone-else" } },
      });

      render(<RecoverPasskeyPage />);
      fireEvent.click(
        await screen.findByRole("button", { name: USE_PASSKEY_LABEL })
      );

      expect(await screen.findByText(OTHER_ACCOUNT_MESSAGE)).toBeTruthy();
      expect(trpcMocks.recoveryOptions).toHaveBeenCalledOnce();
    });
  });

  describe("connecting the new passkey", () => {
    it("retires the only other passkey when no passkey was used", async () => {
      render(<VaultRecovery newPasskey={newPasskey} />);

      fireEvent.click(
        await screen.findByRole("button", { name: UNLOCK_WITH_PASSWORD_LABEL })
      );

      await waitFor(() =>
        expect(vaultMocks.removePasskey).toHaveBeenCalledWith({
          id: "passkey-working",
          credentialId: "cred-working",
          opensVault: true,
        })
      );
      expect(offeredPasskeys.ids).toEqual([]);
    });

    it("keeps every passkey when this session signed in with one", async () => {
      render(<VaultRecovery newPasskey={newPasskey} passkeyInUse />);

      fireEvent.click(
        await screen.findByRole("button", { name: UNLOCK_WITH_PASSWORD_LABEL })
      );

      expect(await screen.findByText(REMOVE_LOST_HEADING)).toBeTruthy();
      expect(offeredPasskeys.ids).toEqual(["cred-working"]);
      expect(vaultMocks.addVaultCredential).toHaveBeenCalledWith(
        unlockVaultKey,
        newPasskey
      );
      expect(vaultMocks.removePasskey).not.toHaveBeenCalled();
    });

    it("keeps the passkey in use when starting over with new keys", async () => {
      trpcMocks.access.mockResolvedValue({
        ...access,
        password: null,
        unlockingCount: 1,
      });
      passkeyMocks.withPasskeyConfirmation.mockImplementation(
        (action: () => Promise<unknown>) => action()
      );
      trpcMocks.resetVault.mockResolvedValue(undefined);

      render(<VaultRecovery newPasskey={newPasskey} passkeyInUse />);

      // The passkey in use still opens the vault, so the unlock step stays.
      fireEvent.click(
        await screen.findByRole("button", { name: NONE_OF_THESE_LABEL })
      );
      fireEvent.click(
        await screen.findByRole("button", { name: START_OVER_LABEL })
      );

      await waitFor(() => expect(trpcMocks.resetVault).toHaveBeenCalled());
      expect(passkeyMocks.deletePasskey).not.toHaveBeenCalled();
    });
  });
});
