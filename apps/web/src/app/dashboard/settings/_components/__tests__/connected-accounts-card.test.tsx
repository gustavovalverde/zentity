// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkSocial: vi.fn(),
  refresh: vi.fn(),
  unlinkAccount: vi.fn(),
  withPasskeyConfirmation: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    linkSocial: mocks.linkSocial,
    unlinkAccount: mocks.unlinkAccount,
  },
}));
vi.mock("@/lib/auth/passkey/client", () => ({
  withPasskeyConfirmation: mocks.withPasskeyConfirmation,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { ConnectedAccountsCard } from "../connected-accounts-card";

const GOOGLE_ACCOUNT = {
  id: "account-row-1",
  providerId: "google",
  createdAt: new Date("2026-11-01T00:00:00Z"),
};

function renderCard(linkError?: string) {
  return render(
    <ConnectedAccountsCard
      accounts={[GOOGLE_ACCOUNT]}
      linkError={linkError}
      providers={["google", "github"]}
    />
  );
}

describe("ConnectedAccountsCard", () => {
  beforeEach(() => {
    mocks.withPasskeyConfirmation.mockImplementation(
      (action: () => Promise<unknown>) => action()
    );
    mocks.linkSocial.mockResolvedValue({
      data: { url: "https://github.com/login/oauth/authorize", redirect: true },
      error: null,
    });
    mocks.unlinkAccount.mockResolvedValue({
      data: { status: true },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("links a provider through the passkey confirmation", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Link GitHub" }));

    await waitFor(() =>
      expect(mocks.linkSocial).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: "/dashboard/settings?tab=account",
        errorCallbackURL: "/dashboard/settings?tab=account",
      })
    );
    expect(mocks.withPasskeyConfirmation).toHaveBeenCalledOnce();
  });

  it("unlinks the account by its id through the passkey confirmation", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Unlink Google" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.withPasskeyConfirmation).toHaveBeenCalledOnce();
    expect(mocks.unlinkAccount).toHaveBeenCalledWith({
      accountId: "account-row-1",
    });
  });

  it("shows why the change did not happen", async () => {
    mocks.withPasskeyConfirmation.mockRejectedValue(
      new Error("Nothing was changed.")
    );
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Unlink Google" }));

    expect(await screen.findByText("Nothing was changed.")).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("explains a link the provider callback refused", () => {
    renderCard("email_does_not_match");

    expect(
      screen.getByText(
        "That account uses a different email address than your Zentity account."
      )
    ).toBeTruthy();
  });
});
