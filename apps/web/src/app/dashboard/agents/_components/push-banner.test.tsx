// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMocks = vi.hoisted(() => ({
  getPushState: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

vi.mock("@/lib/agents/push-client", () => pushMocks);

import { PushNotificationBanner } from "./push-banner";

const ENABLE_RE = /Enable Notifications/;
const BLOCKED_RE = /could not be turned on in this browser/;

describe("PushNotificationBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    pushMocks.getPushState.mockResolvedValue("prompt");
  });

  it("keeps the banner and shows an error when subscribing throws", async () => {
    pushMocks.subscribeToPush.mockRejectedValue(
      new DOMException("Registration failed", "AbortError")
    );

    render(<PushNotificationBanner />);
    fireEvent.click(await screen.findByRole("button", { name: ENABLE_RE }));

    expect(await screen.findByText(BLOCKED_RE)).toBeTruthy();
    expect(screen.getByRole("button", { name: ENABLE_RE })).toBeTruthy();
  });

  it("shows an error when subscribing fails without a permission denial", async () => {
    pushMocks.subscribeToPush.mockResolvedValue(null);

    render(<PushNotificationBanner />);
    fireEvent.click(await screen.findByRole("button", { name: ENABLE_RE }));

    expect(await screen.findByText(BLOCKED_RE)).toBeTruthy();
  });

  it("shows the active state without an error once subscribed", async () => {
    pushMocks.subscribeToPush.mockResolvedValue({});

    render(<PushNotificationBanner />);
    fireEvent.click(await screen.findByRole("button", { name: ENABLE_RE }));

    expect(await screen.findByText("Push notifications active")).toBeTruthy();
    expect(screen.queryByText(BLOCKED_RE)).toBeNull();
  });
});
