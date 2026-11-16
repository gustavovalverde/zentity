// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADD_PASSKEY_LABEL = /add passkey/i;
const PASSWORD_PLACEHOLDER = /enter your password/i;
const VERIFY_ADD_PASSKEY_LABEL = /verify & add passkey/i;

const RECOVER_ACCOUNT_LABEL = /recover your account/i;

const passkeyMocks = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(),
  registerPasskeyWithPrf: vi.fn(),
  renamePasskey: vi.fn(),
  withPasskeyConfirmation: vi.fn(),
}));

vi.mock("@/lib/auth/passkey/client", () => ({
  listUserPasskeys: passkeyMocks.listUserPasskeys,
  registerPasskeyWithPrf: passkeyMocks.registerPasskeyWithPrf,
  renamePasskey: passkeyMocks.renamePasskey,
  withPasskeyConfirmation: passkeyMocks.withPasskeyConfirmation,
}));

const vaultMocks = vi.hoisted(() => ({
  addVaultCredential: vi.fn(),
  removePasskey: vi.fn(),
  unlockVaultKey: vi.fn(),
  vaultPasskeySalts: vi.fn(),
}));

vi.mock("@/lib/privacy/secrets/vault", () => vaultMocks);

const promptMocks = vi.hoisted(() => ({
  requestVaultKey: vi.fn(),
}));

vi.mock("@/components/vault-unlock", () => ({
  useVaultKeyPrompt: () => ({
    dialog: null,
    requestVaultKey: promptMocks.requestVaultKey,
  }),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const authClientMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: {
    opaque: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: authClientMocks,
}));

vi.mock("@/lib/auth/passkey/prf", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/passkey/prf")>();
  return {
    ...actual,
    checkPrfSupport: vi.fn().mockResolvedValue({ supported: true }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { PasskeyManagementSection } from "../passkey-management-section";

const vaultKey = {
  key: new Uint8Array(32).fill(9),
  secretId: "secret-1",
  unlockedWith: "opaque",
  userId: "user-1",
};

describe("PasskeyManagementSection integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    passkeyMocks.withPasskeyConfirmation.mockImplementation(
      (action: () => Promise<unknown>) => action()
    );
    vaultMocks.vaultPasskeySalts.mockResolvedValue({});
    passkeyMocks.listUserPasskeys.mockResolvedValue({ data: [] });
    passkeyMocks.registerPasskeyWithPrf.mockResolvedValue({
      ok: true,
      credentialId: "cred-1",
      prfOutput: new Uint8Array(32).fill(1),
    });
  });

  it("connects a new passkey to an unlocked vault", async () => {
    promptMocks.requestVaultKey.mockResolvedValue({
      status: "unlocked",
      vaultKey,
    });

    render(<PasskeyManagementSection access={null} />);

    fireEvent.click(
      await screen.findByRole("button", { name: ADD_PASSKEY_LABEL })
    );

    await waitFor(() => {
      expect(vaultMocks.addVaultCredential).toHaveBeenCalledWith(
        vaultKey,
        expect.objectContaining({ type: "passkey", credentialId: "cred-1" })
      );
    });
    expect(authClientMocks.signIn.opaque).not.toHaveBeenCalled();
  });

  it("adds the first passkey without a password when there is no vault yet", async () => {
    promptMocks.requestVaultKey.mockResolvedValue({ status: "no_vault" });

    render(<PasskeyManagementSection access={null} />);

    fireEvent.click(
      await screen.findByRole("button", { name: ADD_PASSKEY_LABEL })
    );

    await waitFor(() => {
      expect(passkeyMocks.registerPasskeyWithPrf).toHaveBeenCalled();
    });
    expect(authClientMocks.signIn.opaque).not.toHaveBeenCalled();
    expect(vaultMocks.addVaultCredential).not.toHaveBeenCalled();
  });

  it("confirms with a passkey that also opens the vault", async () => {
    const prfSalt = new Uint8Array(32).fill(3);
    const prfOutput = new Uint8Array(32).fill(4);
    passkeyMocks.listUserPasskeys.mockResolvedValue({
      data: [{ id: "pk-1", credentialID: "existing", name: "Laptop" }],
    });
    vaultMocks.vaultPasskeySalts.mockResolvedValue({ existing: prfSalt });
    vaultMocks.unlockVaultKey.mockResolvedValue(vaultKey);
    passkeyMocks.withPasskeyConfirmation.mockImplementation(
      (
        action: () => Promise<unknown>,
        options: {
          onPasskeyConfirmed: (confirmation: {
            credentialId: string;
            prfOutput: Uint8Array;
          }) => void;
        }
      ) => {
        options.onPasskeyConfirmed({ credentialId: "existing", prfOutput });
        return action();
      }
    );

    render(<PasskeyManagementSection access={null} />);

    fireEvent.click(
      await screen.findByRole("button", { name: ADD_PASSKEY_LABEL })
    );

    await waitFor(() => {
      expect(vaultMocks.addVaultCredential).toHaveBeenCalledWith(
        vaultKey,
        expect.objectContaining({ credentialId: "cred-1" })
      );
    });
    expect(passkeyMocks.withPasskeyConfirmation).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ credentialIdToSalt: { existing: prfSalt } })
    );
    expect(vaultMocks.unlockVaultKey).toHaveBeenCalledWith({
      type: "passkey",
      credentialId: "existing",
      prfOutput,
      prfSalt,
    });
    expect(promptMocks.requestVaultKey).not.toHaveBeenCalled();
  });

  it("points to account recovery when the passkey is not here", async () => {
    passkeyMocks.listUserPasskeys.mockResolvedValue({
      data: [{ id: "pk-1", credentialID: "existing", name: "Laptop" }],
    });

    render(<PasskeyManagementSection access={null} />);

    const link = await screen.findByRole("link", {
      name: RECOVER_ACCOUNT_LABEL,
    });
    expect(link.getAttribute("href")).toBe("/recovery/passkey");
  });

  it("asks for the password when a stale session has no passkey to step up with", async () => {
    promptMocks.requestVaultKey.mockResolvedValue({
      status: "unlocked",
      vaultKey,
    });
    passkeyMocks.registerPasskeyWithPrf.mockResolvedValueOnce({
      ok: false,
      error: { code: "SESSION_NOT_FRESH", status: 403 },
      message: "Session is not fresh",
    });
    authClientMocks.getSession.mockResolvedValue({
      data: { user: { email: "user@example.com" } },
    });
    authClientMocks.signIn.opaque.mockResolvedValue({
      data: { user: { id: "user-1" }, exportKey: new Uint8Array(32).fill(2) },
    });

    render(<PasskeyManagementSection access={null} />);

    fireEvent.click(
      await screen.findByRole("button", { name: ADD_PASSKEY_LABEL })
    );
    fireEvent.change(await screen.findByPlaceholderText(PASSWORD_PLACEHOLDER), {
      target: { value: "hunter2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: VERIFY_ADD_PASSKEY_LABEL })
    );

    await waitFor(() => {
      expect(vaultMocks.addVaultCredential).toHaveBeenCalledWith(
        vaultKey,
        expect.objectContaining({ credentialId: "cred-1" })
      );
    });
  });
});
