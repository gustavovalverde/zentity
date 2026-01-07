// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const ADD_PASSKEY_LABEL = /add passkey/i;

const authMocks = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  updatePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    passkey: {
      listUserPasskeys: authMocks.listUserPasskeys,
      addPasskey: authMocks.addPasskey,
      updatePasskey: authMocks.updatePasskey,
      deletePasskey: authMocks.deletePasskey,
    },
  },
}));

const vaultMocks = vi.hoisted(() => ({
  addWrapperForSecretType: vi.fn(),
}));

vi.mock("@/lib/crypto/secret-vault", () => vaultMocks);

vi.mock("@/lib/crypto/key-derivation", () => ({
  generatePrfSalt: vi.fn().mockReturnValue(new Uint8Array(32).fill(7)),
}));

vi.mock("@/lib/crypto/webauthn-prf", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/crypto/webauthn-prf")>();
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
    authMocks.listUserPasskeys.mockResolvedValue({ data: [] });
    authMocks.addPasskey.mockResolvedValue({
      data: { credentialID: "cred-1" },
      webauthn: {
        response: { id: "cred-1", rawId: "cred-1" },
        clientExtensionResults: {
          prf: { results: { first: new Uint8Array(32).fill(1) } },
        },
      },
    });
    vaultMocks.addWrapperForSecretType.mockResolvedValue(true);

    render(<PasskeyManagementSection />);

    const addButton = await screen.findByRole("button", {
      name: ADD_PASSKEY_LABEL,
    });

    fireEvent.click(addButton);

    await waitFor(() => {
      expect(authMocks.addPasskey).toHaveBeenCalled();
      expect(vaultMocks.addWrapperForSecretType).toHaveBeenCalledTimes(2);
    });
  });
});
