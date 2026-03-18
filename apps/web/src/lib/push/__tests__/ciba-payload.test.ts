import { describe, expect, it } from "vitest";

import { buildCibaPushPayload, buildNotificationBody } from "../ciba-payload";

const ORIGIN = "https://app.zentity.xyz";

describe("buildCibaPushPayload", () => {
  it("sets requiresVaultUnlock to true for identity-scoped requests", () => {
    const payload = buildCibaPushPayload(
      {
        authReqId: "req-1",
        scope: "openid identity.name identity.dob",
      },
      ORIGIN
    );

    expect(payload.data.requiresVaultUnlock).toBe(true);
  });

  it("sets requiresVaultUnlock to false for non-identity requests", () => {
    const payload = buildCibaPushPayload(
      {
        authReqId: "req-2",
        scope: "openid proof:identity",
      },
      ORIGIN
    );

    expect(payload.data.requiresVaultUnlock).toBe(false);
  });

  it("sets requiresVaultUnlock to true when any identity scope is present", () => {
    for (const scope of [
      "identity.name",
      "identity.dob",
      "identity.address",
      "identity.document",
      "identity.nationality",
    ]) {
      const payload = buildCibaPushPayload(
        { authReqId: "req-x", scope: `openid ${scope}` },
        ORIGIN
      );
      expect(payload.data.requiresVaultUnlock).toBe(true);
    }
  });

  it("builds correct approvalUrl from origin and authReqId", () => {
    const payload = buildCibaPushPayload(
      { authReqId: "abc-123", scope: "openid" },
      ORIGIN
    );

    expect(payload.data.approvalUrl).toBe(
      "https://app.zentity.xyz/approve/abc-123"
    );
  });

  it("encodes special characters in authReqId for the URL", () => {
    const payload = buildCibaPushPayload(
      { authReqId: "req/with spaces", scope: "openid" },
      ORIGIN
    );

    expect(payload.data.approvalUrl).toBe(
      "https://app.zentity.xyz/approve/req%2Fwith%20spaces"
    );
  });

  it("uses client name in body when provided", () => {
    const payload = buildCibaPushPayload(
      {
        authReqId: "req-1",
        scope: "openid",
        clientName: "Aether AI",
      },
      ORIGIN
    );

    expect(payload.body).toBe("Aether AI is requesting access");
  });

  it("falls back to 'An application' when clientName is absent", () => {
    const payload = buildCibaPushPayload(
      { authReqId: "req-1", scope: "openid" },
      ORIGIN
    );

    expect(payload.body).toBe("An application is requesting access");
  });

  it("defaults title to 'Authorization Request' when no agentName", () => {
    const payload = buildCibaPushPayload(
      { authReqId: "req-1", scope: "openid" },
      ORIGIN
    );

    expect(payload.title).toBe("Authorization Request");
  });

  it("uses agentName in title when provided", () => {
    const payload = buildCibaPushPayload(
      { authReqId: "req-1", scope: "openid", agentName: "Claude Code" },
      ORIGIN
    );

    expect(payload.title).toBe("Claude Code requests approval");
  });
});

describe("buildNotificationBody", () => {
  it("uses binding message when present", () => {
    expect(buildNotificationBody("App", "Confirm purchase", undefined)).toBe(
      "App: Confirm purchase"
    );
  });

  it("formats purchase authorization detail", () => {
    const details = [
      {
        type: "purchase",
        item: "Premium Plan",
        amount: { value: "9.99", currency: "USD" },
      },
    ];

    expect(buildNotificationBody("App", undefined, details)).toBe(
      "App: Premium Plan for $9.99"
    );
  });

  it("formats non-USD currency", () => {
    const details = [
      {
        type: "purchase",
        item: "Widget",
        amount: { value: "100", currency: "EUR" },
      },
    ];

    expect(buildNotificationBody("App", undefined, details)).toBe(
      "App: Widget for 100 EUR"
    );
  });

  it("omits amount when missing from purchase detail", () => {
    const details = [{ type: "purchase", item: "Widget" }];

    expect(buildNotificationBody("App", undefined, details)).toBe(
      "App: Widget"
    );
  });

  it("falls back to generic message when no binding message or purchase", () => {
    expect(buildNotificationBody("App", undefined, undefined)).toBe(
      "App is requesting access"
    );
  });

  it("prefers binding message over authorization details", () => {
    const details = [
      {
        type: "purchase",
        item: "Plan",
        amount: { value: "5", currency: "USD" },
      },
    ];

    expect(buildNotificationBody("App", "Custom message", details)).toBe(
      "App: Custom message"
    );
  });
});
