// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/auth/passkey", () => ({
  listUserPasskeys: passkeyMocks.listUserPasskeys,
  registerPasskeyWithPrf: passkeyMocks.registerPasskeyWithPrf,
  signInWithPasskey: passkeyMocks.signInWithPasskey,
  renamePasskey: passkeyMocks.renamePasskey,
  deletePasskey: passkeyMocks.deletePasskey,
}));

const secretsMocks = vi.hoisted(() => ({
  addWrapperForSecretType: vi.fn(),
}));

const credentialsMocks = vi.hoisted(() => ({
  generatePrfSalt: vi.fn().mockReturnValue(new Uint8Array(32).fill(7)),
}));

vi.mock("@/lib/privacy/secrets", () => secretsMocks);
vi.mock("@/lib/privacy/credentials", () => credentialsMocks);

const authClientMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: {
    opaque: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: authClientMocks,
}));

vi.mock("@/lib/auth/webauthn-prf", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/webauthn-prf")>();
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

import { PasskeyManagementSection } from "@/components/dashboard/passkey-management-section";

describe("PasskeyManagementSection integration", () => {
  it("adds a passkey and wraps secrets", async () => {
    passkeyMocks.listUserPasskeys.mockResolvedValue({ data: [] });
    authClientMocks.getSession.mockResolvedValue({
      data: { user: { email: "anon@anon.zentity.app" } },
    });
    authClientMocks.signIn.opaque.mockResolvedValue({
      data: { user: { id: "user-1" }, exportKey: new Uint8Array(32).fill(2) },
    });
    passkeyMocks.registerPasskeyWithPrf.mockResolvedValue({
      ok: true,
      credentialId: "cred-1",
      prfOutput: new Uint8Array(32).fill(1),
    });
    secretsMocks.addWrapperForSecretType.mockResolvedValue(true);

    render(<PasskeyManagementSection />);

    const addButton = await screen.findByRole("button", {
      name: ADD_PASSKEY_LABEL,
    });

    fireEvent.click(addButton);

    const passwordInput =
      await screen.findByPlaceholderText(PASSWORD_PLACEHOLDER);
    fireEvent.change(passwordInput, { target: { value: "hunter2" } });

    const confirmButton = screen.getByRole("button", {
      name: VERIFY_ADD_PASSKEY_LABEL,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(passkeyMocks.registerPasskeyWithPrf).toHaveBeenCalled();
      expect(secretsMocks.addWrapperForSecretType).toHaveBeenCalledTimes(2);
    });
  });
});
