// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAuthUI } from "@/test-utils/auth-ui-test-utils";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { getSession: mocks.getSession },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { AuthCallback } from "./auth-callback";

const ORIGIN = "http://localhost:3000";

function openCallback(search: string) {
  vi.stubGlobal("location", {
    origin: ORIGIN,
    pathname: "/callback",
    search,
    replace: mocks.replace,
  });
  renderWithAuthUI(<AuthCallback />);
}

function signedIn() {
  mocks.getSession.mockResolvedValue({
    session: { id: "session-1", userId: "user-1" },
    user: { id: "user-1" },
  });
}

describe("AuthCallback", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("forwards a signed-in user to the requested same-origin page", async () => {
    signedIn();
    openCallback("?redirectTo=%2Fdashboard%2Fsettings%3Ftab%3Daccount");

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/dashboard/settings?tab=account"
      )
    );
  });

  it("forwards a signed-in user to the dashboard when no target is given", async () => {
    signedIn();
    openCallback("");

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard")
    );
  });

  it.each([
    "https://evil.example/dashboard",
    "//evil.example",
    "/\\evil.example",
    "http://localhost:3000@evil.example/",
    "javascript:alert(1)",
  ])("sends a signed-in user home instead of to %s", async (target) => {
    signedIn();
    openCallback(`?redirectTo=${encodeURIComponent(target)}`);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });

  it("sends a signed-out visitor to sign in and keeps the target", async () => {
    openCallback("?redirectTo=%2Fdashboard%2Fsettings");

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/sign-in?callbackURL=%2Fdashboard%2Fsettings"
      )
    );
  });

  it("drops an off-site target before sending a signed-out visitor to sign in", async () => {
    openCallback("?redirectTo=https%3A%2F%2Fevil.example");

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/sign-in?callbackURL=%2F")
    );
  });
});
