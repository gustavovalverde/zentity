import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureDefaultHostPolicies,
  evaluateSessionGrants,
} from "@/lib/agents/approval-evaluate";
import { db } from "@/lib/db/connection";
import {
  agentHostPolicies,
  agentHosts,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { ensureCapabilitiesSeeded } from "@/lib/db/seed";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const TEST_CLIENT_ID = "grant-evaluation-client";

async function createOAuthClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createSession(userId: string) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: TEST_CLIENT_ID,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
      publicKeyThumbprint: `host-thumbprint-${crypto.randomUUID()}`,
      name: "Test Host",
      attestationTier: "attested",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected host fixture to be created");
  }

  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host.id,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
      publicKeyThumbprint: `agent-thumbprint-${crypto.randomUUID()}`,
      displayName: "Claude Code",
    })
    .returning({ id: agentSessions.id });
  if (!session) {
    throw new Error("Expected session fixture to be created");
  }

  return { hostId: host.id, sessionId: session.id };
}

describe("evaluateSessionGrants", () => {
  let hostId: string;
  let sessionId: string;

  beforeEach(async () => {
    await resetDatabase();
    await ensureCapabilitiesSeeded();
    const userId = await createTestUser();
    await createOAuthClient(TEST_CLIENT_ID);
    const created = await createSession(userId);
    hostId = created.hostId;
    sessionId = created.sessionId;
  });

  it("keeps identity-scoped my_profile manual even with an active grant", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "my_profile",
        sessionId,
        source: "host_policy",
        status: "active",
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(
      sessionId,
      "openid identity.name identity.address",
      []
    );

    expect(result).toEqual(
      expect.objectContaining({
        approved: false,
        approvalStrength: "session",
        capabilityName: "my_profile",
        reason: "identity scopes require explicit approval",
      })
    );
  });

  it("prioritizes purchase details over identity scopes", async () => {
    const result = await evaluateSessionGrants(
      sessionId,
      "openid identity.name",
      [
        {
          type: "purchase",
          merchant: "Acme",
          item: "Widget",
          amount: { value: "9.99", currency: "USD" },
        },
      ]
    );

    expect(result).toEqual(
      expect.objectContaining({
        approved: false,
        approvalStrength: "biometric",
        capabilityName: "purchase",
        reason: "biometric approval required",
      })
    );
  });

  it("keeps purchase manual even when an active grant exists", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "purchase",
        sessionId,
        source: "host_policy",
        status: "active",
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(sessionId, "openid", [
      {
        type: "purchase",
        merchant: "Acme",
        item: "Widget",
        amount: { value: "9.99", currency: "USD" },
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        approved: false,
        approvalStrength: "biometric",
        reason: "biometric approval required",
      })
    );
  });

  const PAYMENT_RECIPIENT = "zcash:test:utest1qqallowedrecipient0000";
  const paymentRar = (overrides?: { recipient?: string; value?: string }) => ({
    type: "payment_authorization" as const,
    chain: { namespace: "zcash", reference: "test" },
    recipient: overrides?.recipient ?? PAYMENT_RECIPIENT,
    amount: {
      currency: "ZEC",
      value: overrides?.value ?? "100000",
      unit: "base",
    },
    payment_id: "pay_1",
    intent_hash: `v1:sha256:${"A".repeat(43)}`,
    expires_at: { kind: "block_height", value: 4_056_276 },
  });
  const boundedConstraints = JSON.stringify([
    { field: "recipient", op: "in", values: [PAYMENT_RECIPIENT] },
    { field: "amount.value", op: "max", value: 200_000 },
  ]);

  it("auto-approves a payment within a bounded grant (recipient allowlist + amount ceiling)", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "payment_authorization:sign",
        sessionId,
        source: "host_policy",
        status: "active",
        constraints: boundedConstraints,
        dailyLimitAmount: 1_000_000,
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(
      sessionId,
      "openid payment_authorization:sign",
      [paymentRar()]
    );

    expect(result.approved).toBe(true);
    expect(result.capabilityName).toBe("payment_authorization:sign");
  });

  it("refuses to auto-approve an UNBOUNDED payment grant (empty constraints, no limit)", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "payment_authorization:sign",
        sessionId,
        source: "host_policy",
        status: "active",
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(
      sessionId,
      "openid payment_authorization:sign",
      [paymentRar()]
    );

    expect(result.approved).toBe(false);
  });

  it("falls through to manual when a payment exceeds the amount ceiling", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "payment_authorization:sign",
        sessionId,
        source: "host_policy",
        status: "active",
        constraints: boundedConstraints,
        dailyLimitAmount: 1_000_000,
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(
      sessionId,
      "openid payment_authorization:sign",
      [paymentRar({ value: "300000" })]
    );

    expect(result.approved).toBe(false);
  });

  it("falls through to manual when a payment recipient is not allowlisted", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "payment_authorization:sign",
        sessionId,
        source: "host_policy",
        status: "active",
        constraints: boundedConstraints,
        dailyLimitAmount: 1_000_000,
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(
      sessionId,
      "openid payment_authorization:sign",
      [paymentRar({ recipient: "zcash:test:utest1qqattackeraddr9999" })]
    );

    expect(result.approved).toBe(false);
  });

  it("approves proof-only requests when they map to an active my_proofs grant", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "my_proofs",
        sessionId,
        source: "host_policy",
        status: "active",
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(
      sessionId,
      "openid proof:age",
      []
    );

    expect(result).toEqual(
      expect.objectContaining({
        approved: true,
        approvalStrength: "none",
        capabilityName: "my_proofs",
      })
    );
  });

  it("returns no matching capability for openid-only requests", async () => {
    const result = await evaluateSessionGrants(sessionId, "openid", []);

    expect(result).toEqual({
      approved: false,
      reason: "no matching capability for request",
    });
  });

  it("does not widen silent defaults when a host later becomes attested", async () => {
    await ensureDefaultHostPolicies(
      hostId,
      ["whoami", "my_proofs", "check_compliance"],
      "default"
    );
    await ensureDefaultHostPolicies(
      hostId,
      ["whoami", "my_proofs", "check_compliance"],
      "attestation_default"
    );

    const policies = await db
      .select({
        capabilityName: agentHostPolicies.capabilityName,
        source: agentHostPolicies.source,
        status: agentHostPolicies.status,
      })
      .from(agentHostPolicies)
      .all();

    expect(
      policies.toSorted((left, right) =>
        left.capabilityName.localeCompare(right.capabilityName)
      )
    ).toEqual([
      {
        capabilityName: "check_compliance",
        source: "default",
        status: "active",
      },
      {
        capabilityName: "my_proofs",
        source: "default",
        status: "active",
      },
      {
        capabilityName: "whoami",
        source: "default",
        status: "active",
      },
    ]);
  });
});
