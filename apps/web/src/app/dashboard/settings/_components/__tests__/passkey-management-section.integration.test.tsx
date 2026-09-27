// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADD_PASSKEY_LABEL = /add passkey/i;
const PASSWORD_PLACEHOLDER = /enter your password/i;
const VERIFY_ADD_PASSKEY_LABEL = /verify & add passkey/i;

const passkeyMocks = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(),
  registerPasskeyWithPrf: vi.fn(),
  signInWithPasskey: vi.fn(),
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth/passkey/client", () => ({
  listUserPasskeys: passkeyMocks.listUserPasskeys,
  registerPasskeyWithPrf: passkeyMocks.registerPasskeyWithPrf,
  signInWithPasskey: passkeyMocks.signInWithPasskey,
  renamePasskey: passkeyMocks.renamePasskey,
  deletePasskey: passkeyMocks.deletePasskey,
}));

const vaultMocks = vi.hoisted(() => ({
  addVaultCredential: vi.fn(),
  removeVaultCredential: vi.fn(),
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

  it("steps up with the password when there is no vault yet", async () => {
    promptMocks.requestVaultKey.mockResolvedValue({ status: "no_vault" });
    authClientMocks.getSession.mockResolvedValue({
      data: { user: { email: "anon@anon.zentity.app" } },
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
      expect(passkeyMocks.registerPasskeyWithPrf).toHaveBeenCalled();
    });
    expect(vaultMocks.addVaultCredential).not.toHaveBeenCalled();
  });
});
