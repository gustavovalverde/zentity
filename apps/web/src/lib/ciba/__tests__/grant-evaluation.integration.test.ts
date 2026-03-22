import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureDefaultHostPolicies,
  evaluateSessionGrants,
} from "@/lib/ciba/grant-evaluation";
import { db } from "@/lib/db/connection";
import {
  agentHostPolicies,
  agentHosts,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { ensureCapabilitiesSeeded } from "@/lib/db/seed/capabilities";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

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
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
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
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "agent" }),
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

  it("keeps identity-scoped read_profile manual even with an active grant", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "read_profile",
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
        capabilityName: "read_profile",
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

  it("approves proof-only requests when they map to an active check_compliance grant", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "check_compliance",
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
        capabilityName: "check_compliance",
      })
    );
  });

  it("keeps request_approval manual even when an active grant exists", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "request_approval",
        sessionId,
        source: "host_policy",
        status: "active",
        grantedAt: new Date(),
      })
      .run();

    const result = await evaluateSessionGrants(sessionId, "openid", []);

    expect(result).toEqual(
      expect.objectContaining({
        approved: false,
        approvalStrength: "session",
        capabilityName: "request_approval",
        reason: "explicit approval required",
      })
    );
  });

  it("does not widen silent defaults when a host later becomes attested", async () => {
    await ensureDefaultHostPolicies(
      hostId,
      ["check_compliance", "request_approval"],
      "default"
    );
    await ensureDefaultHostPolicies(
      hostId,
      ["check_compliance", "request_approval"],
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
        capabilityName: "request_approval",
        source: "default",
        status: "active",
      },
    ]);
  });
});
