// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAuthUI } from "@/test-utils/auth-ui-test-utils";

const mocks = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
  withPasskeyConfirmation: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: vi.fn().mockResolvedValue(null),
    sendVerificationEmail: mocks.sendVerificationEmail,
  },
}));
vi.mock("@/lib/auth/passkey/client", () => ({
  withPasskeyConfirmation: mocks.withPasskeyConfirmation,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { EmailVerificationCard } from "./email-verification-card";

function waitOutCooldown() {
  for (let second = 0; second < 60; second++) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

describe("EmailVerificationCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.withPasskeyConfirmation.mockImplementation(
      (action: () => Promise<unknown>) => action()
    );
    mocks.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("holds the resend button for 60 seconds after the first email", () => {
    renderWithAuthUI(<EmailVerificationCard email="ada@example.com" />);

    const button = screen.getByRole("button", { name: "Resend in 60s" });
    expect(button.hasAttribute("disabled")).toBe(true);

    waitOutCooldown();

    expect(
      screen
        .getByRole("button", { name: "Resend email" })
        .hasAttribute("disabled")
    ).toBe(false);
  });

  it("resends through the passkey confirmation and restarts the cooldown", async () => {
    renderWithAuthUI(<EmailVerificationCard email="ada@example.com" />);
    waitOutCooldown();

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    await waitFor(() =>
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        email: "ada@example.com",
        callbackURL: "/dashboard",
      })
    );
    expect(mocks.withPasskeyConfirmation).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", { name: "Resend in 60s" })
    ).toBeTruthy();
  });

  it("shows the server's reason when the resend fails", async () => {
    mocks.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { message: "Too many requests. Try again later." },
    });
    renderWithAuthUI(<EmailVerificationCard email="ada@example.com" />);
    waitOutCooldown();

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    expect(
      await screen.findByText("Too many requests. Try again later.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend email" })).toBeTruthy();
  });

  it("offers no resend without an address", () => {
    renderWithAuthUI(<EmailVerificationCard email={null} />);

    expect(
      screen.getByText("Check your email for a verification link")
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
