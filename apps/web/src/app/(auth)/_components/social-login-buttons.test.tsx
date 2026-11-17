// @vitest-environment jsdom

import type { AuthClient } from "@better-auth-ui/core";

import { AuthProvider } from "@better-auth-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));
vi.mock("@/lib/auth/session-cleanup", () => ({
  prepareForNewSession: vi.fn(),
}));

import { SocialLoginButtons } from "./social-login-buttons";

function renderWithProviders(providers: string[]) {
  return render(
    <AuthProvider
      authClient={{} as AuthClient}
      navigate={vi.fn()}
      socialProviders={providers}
    >
      <SocialLoginButtons />
    </AuthProvider>
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
