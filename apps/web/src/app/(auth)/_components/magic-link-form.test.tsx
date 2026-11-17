// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAuthUI } from "@/test-utils/auth-ui-test-utils";

const mocks = vi.hoisted(() => ({
  magicLink: vi.fn(),
  prepareForNewSession: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: vi.fn().mockResolvedValue(null),
    signIn: { magicLink: mocks.magicLink },
  },
}));
vi.mock("@/lib/auth/session-cleanup", () => ({
  prepareForNewSession: mocks.prepareForNewSession,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

import { MagicLinkForm } from "./magic-link-form";

function submitEmail(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send Magic Link" }));
}

describe("MagicLinkForm", () => {
  beforeEach(() => {
    mocks.magicLink.mockResolvedValue({ status: true });
  });

  afterEach(() => {
    cleanup();
    globalThis.history.replaceState(null, "", "/");
  });

  it("sends the link and opens the sent page for that address", async () => {
    renderWithAuthUI(<MagicLinkForm />);

    submitEmail("  ada@example.com ");

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/magic-link/sent?email=ada%40example.com"
      )
    );
    expect(mocks.prepareForNewSession).toHaveBeenCalledTimes(1);
    expect(mocks.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        callbackURL: "/dashboard",
      })
    );
  });

  it("returns to the requested page after sign-in", async () => {
    globalThis.history.replaceState(
      null,
      "",
      "/magic-link?redirectTo=%2Fdashboard%2Fsettings"
    );
    renderWithAuthUI(<MagicLinkForm />);

    submitEmail("ada@example.com");

    await waitFor(() =>
      expect(mocks.magicLink).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: "/dashboard/settings" })
      )
    );
  });

  it("does not carry an off-site target into the link", async () => {
    globalThis.history.replaceState(
      null,
      "",
      "/magic-link?redirectTo=https%3A%2F%2Fevil.example"
    );
    renderWithAuthUI(<MagicLinkForm />);

    submitEmail("ada@example.com");

    await waitFor(() =>
      expect(mocks.magicLink).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: "/dashboard" })
      )
    );
  });

  it("rejects an invalid address without sending", async () => {
    renderWithAuthUI(<MagicLinkForm />);

    submitEmail("not-an-email");

    expect(await screen.findByText("Enter a valid email address")).toBeTruthy();
    expect(mocks.magicLink).not.toHaveBeenCalled();
    expect(mocks.prepareForNewSession).not.toHaveBeenCalled();
  });

  it("explains a failed send and stays on the form", async () => {
    mocks.magicLink.mockRejectedValue(new Error("network down"));
    renderWithAuthUI(<MagicLinkForm />);

    submitEmail("ada@example.com");

    expect(
      await screen.findByText(
        "We couldn't send the link. Check your connection and try again."
      )
    ).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
