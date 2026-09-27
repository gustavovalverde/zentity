// @vitest-environment jsdom

import type { ComponentProps } from "react";

import { AuthUIContext } from "@daveyplate/better-auth-ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));
vi.mock("@/lib/auth/session-cleanup", () => ({
  prepareForNewSession: vi.fn(),
}));

import { SocialLoginButtons } from "./social-login-buttons";

type ContextValue = ComponentProps<typeof AuthUIContext.Provider>["value"];

function renderWithProviders(providers: string[]) {
  const value = { social: { providers } } as unknown as ContextValue;
  return render(
    <AuthUIContext.Provider value={value}>
      <SocialLoginButtons />
    </AuthUIContext.Provider>
  );
}

describe("SocialLoginButtons", () => {
  it("renders nothing when no social provider is configured", () => {
    const { container } = renderWithProviders([]);
    expect(container.innerHTML).toBe("");
  });

  it("renders only the configured providers", () => {
    renderWithProviders(["github"]);
    expect(screen.getByText("Continue with GitHub")).toBeTruthy();
    expect(screen.queryByText("Continue with Google")).toBeNull();
  });
});
