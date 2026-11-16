import { describe, expect, it } from "vitest";

import { buildCibaPushPayload } from "../push-sender";

const APPROVAL_URL = "https://app.zentity.xyz/approve?auth_req_id=req-1";

const EUR_PURCHASE = {
  type: "purchase",
  merchant: { name: "Corner Books" },
  item: "A paperback",
  amount: { value: "12.00", currency: "EUR" },
};

const X402_PURCHASE = {
  type: "x402_purchase",
  resource_url:
    "https://merchant.example/api/x402/access?resourceId=verified-identity",
  resource_description: "Financial analytics",
  payment_requirements: {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  },
  min_identity_strength: "documentary_full",
};

describe("buildCibaPushPayload", () => {
  it("sets requiresVaultUnlock to true for identity-scoped requests", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid identity.name identity.dob",
    });

    expect(payload.data.requiresVaultUnlock).toBe(true);
  });

  it("sets requiresVaultUnlock to false for non-identity requests", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-2",
      approvalUrl: APPROVAL_URL,
      scope: "openid proof:identity",
    });

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
      const payload = buildCibaPushPayload({
        requestId: "req-x",
        approvalUrl: APPROVAL_URL,
        scope: `openid ${scope}`,
      });
      expect(payload.data.requiresVaultUnlock).toBe(true);
    }
  });

  it("passes the plugin-built approvalUrl through to the payload", () => {
    const payload = buildCibaPushPayload({
      requestId: "abc-123",
      approvalUrl: "https://app.zentity.xyz/approve?auth_req_id=abc-123",
      scope: "openid",
    });

    expect(payload.data.approvalUrl).toBe(
      "https://app.zentity.xyz/approve?auth_req_id=abc-123"
    );
  });

  it("carries the request id in the payload data", () => {
    const payload = buildCibaPushPayload({
      requestId: "req/with spaces",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.data.requestId).toBe("req/with spaces");
  });

  it("uses client name in body when provided", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
      clientName: "Aether AI",
    });

    expect(payload.body).toBe("Aether AI is requesting access");
  });

  it("falls back to 'An application' when clientName is absent", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.body).toBe("An application is requesting access");
  });

  it("defaults title to 'An application is requesting access' when no agentName", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.title).toBe("An application is requesting access");
  });

  it("uses agentName in title when provided", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
      agentName: "Claude Code",
    });

    expect(payload.title).toBe("Claude Code requests approval");
  });

  it("formats payment amounts in the asset's display unit", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
      clientName: "Aether AI",
      authorizationDetails: [
        {
          type: "payment_authorization",
          chain: { namespace: "zcash", reference: "test" },
          recipient: "zcash:test:utest1qq0",
          amount: { currency: "ZEC", value: "1", unit: "base" },
          payment_id: "01KT9A0V431VGD5YH7R7G635HC",
          intent_hash: "v1:sha256:tH5IGJbnV6NxSl9nmwbFc8EWDF6rfYcXgOfHFmmIjUQ",
          expires_at: { kind: "block_height", value: 4_047_100 },
        },
      ],
    });

    expect(payload.data.payment).toMatchObject({
      amountDisplay: "0.00000001 ZEC",
    });
    expect(payload.body).toContain("Aether AI: 0.00000001 ZEC on zcash:test");
  });

  const PAYMENT_ENTRY = {
    type: "payment_authorization",
    chain: { namespace: "zcash", reference: "test" },
    recipient: "zcash:test:utest1qq0",
    amount: { currency: "ZEC", value: "1", unit: "base" },
    payment_id: "pay_1",
    intent_hash: `v1:sha256:${"A".repeat(43)}`,
    expires_at: { kind: "block_height", value: 4_047_100 },
  };

  // R1: inline Approve only for requests a notification may approve.
  it.each([
    ["a payment", "openid", [PAYMENT_ENTRY]],
    ["compliance with email", "openid compliance:read email", undefined],
    ["an identity release", "openid identity.name", undefined],
  ])("does not offer inline approval for %s", (_case, scope, details) => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope,
      authorizationDetails: details,
    });

    expect(payload.data.inlineApprove).toBe(false);
    expect(payload.body).not.toContain("Shares:");
  });

  // R15: an inline notification names everything it shares in server text.
  it("lists a server label for every scope an inline request shares", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid compliance:read proof:age",
      clientName: "Aether AI",
      bindingMessage: "Check compliance for checkout",
    });

    expect(payload.data.inlineApprove).toBe(true);
    expect(payload.body).toBe(
      "Aether AI: Check compliance for checkout\nShares: compliance status, age proof"
    );
  });

  it("drops the legacy biometric flag", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.data).not.toHaveProperty("requiresBiometric");
  });

  // R4 and R18: purchases are described in server text, page only.
  it("describes an x402 purchase in server text and never inline", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-x402",
      approvalUrl: APPROVAL_URL,
      scope: "openid poh",
      clientName: "Shopping Agent",
      bindingMessage: "Pay $1 to merchant.example",
      authorizationDetails: [X402_PURCHASE],
    });

    expect(payload.body).toBe(
      "Shopping Agent: Prove your identity to merchant.example (Document, full)"
    );
    expect(payload.data.inlineApprove).toBe(false);
    expect(payload.data).not.toHaveProperty("kind");
    expect(JSON.stringify(payload)).not.toContain("$");
  });

  it("describes a direct purchase in its currency", () => {
    const payload = buildCibaPushPayload({
      requestId: "req-buy",
      approvalUrl: APPROVAL_URL,
      scope: "openid identity.name identity.address",
      clientName: "Shopping Agent",
      bindingMessage: "Buy from Corner Books",
      authorizationDetails: [EUR_PURCHASE],
    });

    expect(payload.body).toBe(
      "Shopping Agent: Purchase stated by the agent: A paperback from Corner Books, €12.00"
    );
    expect(payload.data.inlineApprove).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("$");
  });
});
