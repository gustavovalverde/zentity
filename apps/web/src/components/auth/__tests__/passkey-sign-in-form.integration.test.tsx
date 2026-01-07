// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const PASSKEY_BUTTON_LABEL = /sign in with passkey/i;

const sessionMocks = vi.hoisted(() => ({
  prepareForNewSession: vi.fn(),
}));

vi.mock("@/lib/auth/session-manager", () => sessionMocks);

const authMocks = vi.hoisted(() => ({
  passkeySignIn: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    signIn: {
      passkey: authMocks.passkeySignIn,
    },
  },
}));

vi.mock("@/lib/crypto/webauthn-prf", () => ({
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
    authMocks.passkeySignIn.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });

    render(<PasskeySignInForm />);

    fireEvent.click(screen.getByRole("button", { name: PASSKEY_BUTTON_LABEL }));

    await waitFor(() => {
      expect(sessionMocks.prepareForNewSession).toHaveBeenCalled();
      expect(authMocks.passkeySignIn).toHaveBeenCalled();
      expect(navigationMocks.redirectTo).toHaveBeenCalledWith("/dashboard");
    });
  });
});
