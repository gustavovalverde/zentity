// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./push-banner", () => ({ PushNotificationBanner: () => null }));
vi.mock("./pwa-install-banner", () => ({ PwaInstallBanner: () => null }));

import { RequestsTab } from "./requests-tab";

function requestWith(details: unknown) {
  return {
    approvalChannel: null,
    approvalMethod: null,
    attestationTier: null,
    authorizationDetails: JSON.stringify([details]),
    bindingMessage: "Buy from Shop",
    clientName: "Shopping Agent",
    createdAt: new Date(),
    displayName: null,
    expiresAt: new Date(Date.now() + 60_000),
    id: "req-1",
    model: null,
    runtime: null,
    scope: "openid",
    status: "pending",
  };
}

describe("RequestsTab", () => {
  // D58: the list names what the agent stated, not only the request's type.
  it("shows a direct purchase's item, merchant, and amount", () => {
    render(
      <RequestsTab
        mailpitUrl={null}
        onSelect={vi.fn()}
        requests={[
          requestWith({
            type: "purchase",
            merchant: { name: "Shop" },
            item: "Coffee",
            amount: { value: "12.00", currency: "EUR" },
          }),
        ]}
      />
    );

    expect(
      screen.getByText("Purchase stated by the agent: Coffee from Shop, €12.00")
    ).toBeTruthy();
  });
});
