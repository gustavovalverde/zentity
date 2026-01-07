// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const ADD_PASSKEY_LABEL = /add passkey/i;

const passkeyMocks = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(),
  registerPasskeyWithPrf: vi.fn(),
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth/passkey", () => ({
  listUserPasskeys: passkeyMocks.listUserPasskeys,
  registerPasskeyWithPrf: passkeyMocks.registerPasskeyWithPrf,
  renamePasskey: passkeyMocks.renamePasskey,
  deletePasskey: passkeyMocks.deletePasskey,
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
    passkeyMocks.listUserPasskeys.mockResolvedValue({ data: [] });
    passkeyMocks.registerPasskeyWithPrf.mockResolvedValue({
      ok: true,
      credentialId: "cred-1",
      prfOutput: new Uint8Array(32).fill(1),
    });
    vaultMocks.addWrapperForSecretType.mockResolvedValue(true);

    render(<PasskeyManagementSection />);

    const addButton = await screen.findByRole("button", {
      name: ADD_PASSKEY_LABEL,
    });

    fireEvent.click(addButton);

    await waitFor(() => {
      expect(passkeyMocks.registerPasskeyWithPrf).toHaveBeenCalled();
      expect(vaultMocks.addWrapperForSecretType).toHaveBeenCalledTimes(2);
    });
  });
});
