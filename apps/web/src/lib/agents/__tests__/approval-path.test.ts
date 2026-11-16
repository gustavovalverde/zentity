import { describe, expect, expectTypeOf, it } from "vitest";

import { buildStandaloneApprovalPath } from "@/lib/agents/approval-resolve";
import { approvalPolicy, requiredCeremony } from "@/lib/agents/capability";

describe("buildStandaloneApprovalPath", () => {
  it("returns the standalone approval path without query params", () => {
    expect(buildStandaloneApprovalPath("req-123")).toBe("/approve/req-123");
  });

  it("preserves the cli handoff source query param", () => {
    expect(
      buildStandaloneApprovalPath("req-123", {
        source: "cli_handoff",
      })
    ).toBe("/approve/req-123?source=cli_handoff");
  });
});

const PAYMENT_ENTRY = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50", unit: "base" },
  payment_id: "pay_1",
  intent_hash: `v1:sha256:${"A".repeat(43)}`,
  expires_at: { kind: "block_height", value: 4_056_276 },
};

describe("approvalPolicy", () => {
  it("lets a grant approve a request that maps to one grantable capability", () => {
    expect(approvalPolicy({ scope: "openid compliance:read" })).toEqual({
      ceremony: "session",
      grantCapability: "check_compliance",
      hasIdentityScopes: false,
      inlineApprove: true,
      labels: [
        { scope: "compliance:read", label: "compliance status", inline: true },
      ],
      pageOnly: false,
    });
    expect(
      approvalPolicy({ scope: "openid proof:age proof:nationality" })
        .grantCapability
    ).toBe("my_proofs");
  });

  // R13: one capability does not decide the whole request.
  it("sends a request that spans capabilities or ungrantable scopes to the page", () => {
    const policy = approvalPolicy({
      scope: "openid compliance:read email offline_access proof:nationality",
    });

    expect(policy.grantCapability).toBeNull();
    expect(policy.pageOnly).toBe(true);
    expect(policy.inlineApprove).toBe(false);
    expect(policy.ceremony).toBe("session");
    expect(
      approvalPolicy({ scope: "openid compliance:read proof:age" })
        .grantCapability
    ).toBeNull();
  });

  // R14: a payment grant does not cover extra scopes.
  it("does not let a payment grant cover proof scopes added to the payment", () => {
    const policy = approvalPolicy({
      scope: "openid proof:age",
      authorizationDetails: [PAYMENT_ENTRY],
    });

    expect(policy.grantCapability).toBeNull();
    expect(policy.ceremony).toBe("user_verification");
    expect(policy.pageOnly).toBe(true);
  });

  // The payment entry, not a scope, makes the request a payment.
  it("derives the payment capability from the payment entry alone", () => {
    const policy = approvalPolicy({
      scope: "openid",
      authorizationDetails: JSON.stringify([PAYMENT_ENTRY]),
    });
    expect(policy.grantCapability).toBe("payment_authorization:sign");
    expect(policy.ceremony).toBe("user_verification");
    expect(policy.pageOnly).toBe(true);
  });

  // The capability id is not a scope: as one, it is an unknown item.
  it("treats the payment capability id as an unknown scope", () => {
    expect(
      approvalPolicy({ scope: "openid payment_authorization:sign" })
    ).toEqual(
      expect.objectContaining({ grantCapability: null, pageOnly: true })
    );
  });

  it("treats an unknown scope as page only, not grantable, and session", () => {
    const policy = approvalPolicy({ scope: "openid custom:thing" });

    expect(policy).toEqual(
      expect.objectContaining({
        ceremony: "session",
        grantCapability: null,
        pageOnly: true,
        labels: [
          { scope: "custom:thing", label: "custom:thing", inline: false },
        ],
      })
    );
  });

  it.each([
    ["an unknown type", [{ type: "purchase" }]],
    ["an entry without a type", [{ amount: 1 }]],
    ["details that are not JSON", "not-json"],
    ["details that are not an array", JSON.stringify({ type: "x" })],
  ])("fails closed for %s", (_case, authorizationDetails) => {
    const policy = approvalPolicy({
      scope: "openid compliance:read",
      authorizationDetails,
    });

    expect(policy.ceremony).toBe("user_verification");
    expect(policy.pageOnly).toBe(true);
    expect(policy.grantCapability).toBeNull();
  });

  it("keeps identity scopes off notifications and out of grants", () => {
    const policy = approvalPolicy({ scope: "openid identity.name" });

    expect(policy.hasIdentityScopes).toBe(true);
    expect(policy.pageOnly).toBe(true);
    expect(policy.grantCapability).toBeNull();
    expect(policy.ceremony).toBe("session");
  });

  it("leaves an openid-only request inline but without a grant capability", () => {
    expect(approvalPolicy({ scope: "openid" })).toEqual(
      expect.objectContaining({
        grantCapability: null,
        inlineApprove: true,
        labels: [],
      })
    );
  });

  // R3: the requirement depends only on what the request asks for.
  it("takes no agent-asserted input", () => {
    expectTypeOf<keyof Parameters<typeof approvalPolicy>[0]>().toEqualTypeOf<
      "authorizationDetails" | "scope"
    >();
  });
});

describe("requiredCeremony", () => {
  it("asks passkey holders for user verification on identity releases", () => {
    const policy = approvalPolicy({ scope: "openid identity.name" });

    expect(requiredCeremony(policy, { hasPasskey: true })).toBe(
      "user_verification"
    );
    expect(requiredCeremony(policy, { hasPasskey: false })).toBe("session");
  });

  it("asks for user verification on payments whether or not a passkey exists", () => {
    const policy = approvalPolicy({
      scope: "openid",
      authorizationDetails: [PAYMENT_ENTRY],
    });

    expect(requiredCeremony(policy, { hasPasskey: false })).toBe(
      "user_verification"
    );
  });

  it("keeps session approvals for proof requests", () => {
    const policy = approvalPolicy({ scope: "openid proof:age" });

    expect(requiredCeremony(policy, { hasPasskey: true })).toBe("session");
  });
});
