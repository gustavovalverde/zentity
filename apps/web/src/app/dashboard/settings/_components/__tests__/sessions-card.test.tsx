// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAuthUI } from "@/test-utils/auth-ui-test-utils";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSessions: vi.fn(),
  push: vi.fn(),
  revokeOtherSessions: vi.fn(),
  revokeSession: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
    listSessions: mocks.listSessions,
    revokeOtherSessions: mocks.revokeOtherSessions,
    revokeSession: mocks.revokeSession,
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { SessionsCard } from "../sessions-card";

function session(id: string) {
  return {
    id,
    token: `token-${id}`,
    userId: "user-1",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    expiresAt: new Date("2026-11-08T10:00:00Z"),
  };
}

const CURRENT = session("current");
const LAPTOP = session("laptop");
const PHONE = session("phone");

/** The first session row with this title; the list keeps server order. */
function rowFor(title: string) {
  const row = screen.getAllByText(title)[0]?.closest("[data-slot='item']");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`No session row titled ${title}`);
  }
  return row;
}

describe("SessionsCard", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({
      session: CURRENT,
      user: { id: "user-1" },
    });
    mocks.listSessions.mockResolvedValue([LAPTOP, CURRENT, PHONE]);
    mocks.revokeSession.mockResolvedValue({ status: true });
    mocks.revokeOtherSessions.mockResolvedValue({ status: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists the current session first and the others after it", async () => {
    renderWithAuthUI(<SessionsCard />);

    await screen.findByText("This browser");
    const titles = Array.from(
      document.querySelectorAll("[data-slot='item-title']"),
      (node) => node.textContent
    );
    expect(titles).toEqual([
      "This browserCurrent Session",
      "Another session",
      "Another session",
    ]);
  });

  it("revokes another session by its token", async () => {
    renderWithAuthUI(<SessionsCard />);
    await screen.findByText("This browser");

    fireEvent.click(
      within(rowFor("Another session")).getByRole("button", { name: "Revoke" })
    );

    await waitFor(() =>
      expect(mocks.revokeSession).toHaveBeenCalledWith(
        expect.objectContaining({ token: "token-laptop" })
      )
    );
  });

  it("signs the current browser out through the sign-out page", async () => {
    renderWithAuthUI(<SessionsCard />);
    await screen.findByText("This browser");

    fireEvent.click(
      within(rowFor("This browser")).getByRole("button", { name: "Sign Out" })
    );

    expect(mocks.push).toHaveBeenCalledWith("/sign-out");
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it("signs out other devices after confirmation", async () => {
    renderWithAuthUI(<SessionsCard />);
    await screen.findByText("This browser");

    fireEvent.click(
      screen.getByRole("button", { name: "Sign Out Other Devices" })
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Sign Out Other Devices" })
    );

    await waitFor(() => expect(mocks.revokeOtherSessions).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Signed out of your other devices"
      )
    );
  });

  it("reports a failed revoke", async () => {
    mocks.revokeSession.mockRejectedValue(new Error("Session not found"));
    renderWithAuthUI(<SessionsCard />);
    await screen.findByText("This browser");

    fireEvent.click(
      within(rowFor("Another session")).getByRole("button", { name: "Revoke" })
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't revoke the session",
        { description: "Session not found" }
      )
    );
  });

  it("hides the sign-out-others action when only this browser is signed in", async () => {
    mocks.listSessions.mockResolvedValue([CURRENT]);
    renderWithAuthUI(<SessionsCard />);

    await screen.findByText("This browser");
    expect(
      screen.queryByRole("button", { name: "Sign Out Other Devices" })
    ).toBeNull();
  });

  it("says when the sessions cannot be loaded", async () => {
    // Better Auth UI retries network and 5xx failures; a 403 fails at once.
    mocks.listSessions.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 })
    );
    renderWithAuthUI(<SessionsCard />);

    expect(
      await screen.findByText(
        "Couldn't load your sessions. Refresh the page to try again."
      )
    ).toBeTruthy();
  });
});
