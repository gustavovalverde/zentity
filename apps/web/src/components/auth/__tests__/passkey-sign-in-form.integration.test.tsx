// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const PASSKEY_BUTTON_LABEL = /sign in with passkey/i;

const sessionMocks = vi.hoisted(() => ({
  prepareForNewSession: vi.fn(),
}));

vi.mock("@/lib/auth/session-manager", () => sessionMocks);

const passkeyMocks = vi.hoisted(() => ({
  signInWithPasskey: vi.fn(),
}));

vi.mock("@/lib/auth/passkey", () => ({
  signInWithPasskey: passkeyMocks.signInWithPasskey,
}));

vi.mock("@/lib/auth/webauthn-prf", () => ({
  checkPrfSupport: vi.fn().mockResolvedValue({ supported: true }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const navigationMocks = vi.hoisted(() => ({
  redirectTo: vi.fn(),
}));

vi.mock("@/lib/utils/navigation", () => navigationMocks);

import { PasskeySignInForm } from "@/components/auth/passkey-sign-in-form";

describe("PasskeySignInForm integration", () => {
  it("signs in with passkey and redirects", async () => {
    passkeyMocks.signInWithPasskey.mockResolvedValue({
      ok: true,
      data: { user: { id: "user-1" } },
    });

    render(<PasskeySignInForm />);

    fireEvent.click(screen.getByRole("button", { name: PASSKEY_BUTTON_LABEL }));

    await waitFor(() => {
      expect(sessionMocks.prepareForNewSession).toHaveBeenCalled();
      expect(passkeyMocks.signInWithPasskey).toHaveBeenCalled();
      expect(navigationMocks.redirectTo).toHaveBeenCalledWith("/dashboard");
    });
  });
});
