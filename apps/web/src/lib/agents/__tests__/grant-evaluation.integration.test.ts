import crypto from "node:crypto";

import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ensureDefaultHostPolicies,
  evaluateSessionGrants,
  type GrantConstraint,
} from "@/lib/agents/approval-evaluate";
import {
  type AuthorizationDetail,
  approvalPolicy,
  ensureCapabilitiesSeeded,
} from "@/lib/agents/capability";
import { db } from "@/lib/db/connection";
import {
  agentHostPolicies,
  agentHosts,
  agentSessionGrants,
  agentSessions,
} from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
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

  function evaluateRequest(
    scope: string,
    authorizationDetails: AuthorizationDetail[] = []
  ) {
    return evaluateSessionGrants(
      sessionId,
      approvalPolicy({ scope, authorizationDetails }),
      authorizationDetails
    );
  }

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

    const result = await evaluateRequest(
      "openid identity.name identity.address",
      []
    );

    expect(result).toEqual({
      approved: false,
      reason: "identity scopes require explicit approval",
    });
  });

  it("never approves a purchase from a grant", async () => {
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

    const result = await evaluateRequest("openid", [
      {
        type: "purchase",
        merchant: "Acme",
        item: "Widget",
        amount: { value: "9.99", currency: "USD" },
      },
    ]);

    expect(result).toEqual({
      approved: false,
      reason:
        "request spans more than one capability or includes scopes no grant covers",
    });
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
  const boundedConstraints: GrantConstraint[] = [
    { field: "recipient", op: "in", values: [PAYMENT_RECIPIENT] },
    { field: "amount.value", op: "max", value: 200_000 },
  ];

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

    const result = await evaluateRequest("openid", [paymentRar()]);

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

    const result = await evaluateRequest("openid", [paymentRar()]);

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

    const result = await evaluateRequest("openid", [
      paymentRar({ value: "300000" }),
    ]);

    expect(result.approved).toBe(false);
  });

  describe("daily amount limit", () => {
    const paymentIn = (value: string, unit: string, currency = "ZEC") => ({
      ...paymentRar({ value }),
      amount: { currency, value, unit },
    });

    beforeEach(async () => {
      await db
        .insert(agentSessionGrants)
        .values({
          capabilityName: "payment_authorization:sign",
          sessionId,
          source: "host_policy",
          status: "active",
          dailyLimitAmount: 150_000,
          grantedAt: new Date(),
        })
        .run();
    });

    function evaluate(detail: ReturnType<typeof paymentIn>) {
      return evaluateRequest("openid", [detail]);
    }

    it.each(["-50", "5abc", "1e3", ""])(
      "does not auto-approve the malformed amount %j",
      async (value) => {
        expect((await evaluate(paymentIn(value, "base"))).approved).toBe(false);
      }
    );

    it("counts spends in the same currency and unit against the limit", async () => {
      expect((await evaluate(paymentIn("100000", "base"))).approved).toBe(true);
      expect((await evaluate(paymentIn("100000", "base"))).approved).toBe(
        false
      );
    });

    it.each([
      ["another unit", "1", "display", "ZEC"],
      ["another currency", "1", "base", "USD"],
    ])(
      "does not auto-approve a spend in %s once the day has spending",
      async (_label, value, unit, currency) => {
        expect((await evaluate(paymentIn("100000", "base"))).approved).toBe(
          true
        );
        expect(
          (await evaluate(paymentIn(value, unit, currency))).approved
        ).toBe(false);
      }
    );
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

    const result = await evaluateRequest("openid", [
      paymentRar({ recipient: "zcash:test:utest1qqattackeraddr9999" }),
    ]);

    expect(result.approved).toBe(false);
  });

  it.each<[string, GrantConstraint, boolean]>([
    ["eq match", { field: "amount.currency", op: "eq", value: "ZEC" }, true],
    [
      "eq mismatch",
      { field: "amount.currency", op: "eq", value: "USD" },
      false,
    ],
    ["min met", { field: "amount.value", op: "min", value: 100_000 }, true],
    ["min unmet", { field: "amount.value", op: "min", value: 100_001 }, false],
    [
      "not_in clear",
      { field: "recipient", op: "not_in", values: ["zcash:test:other"] },
      true,
    ],
    [
      "not_in listed",
      { field: "recipient", op: "not_in", values: [PAYMENT_RECIPIENT] },
      false,
    ],
  ])(
    "applies a %s constraint to a bounded payment grant",
    async (_label, constraint, approved) => {
      await db
        .insert(agentSessionGrants)
        .values({
          capabilityName: "payment_authorization:sign",
          sessionId,
          source: "host_policy",
          status: "active",
          constraints: [
            { field: "amount.value", op: "max", value: 200_000 },
            constraint,
          ],
          grantedAt: new Date(),
        })
        .run();

      const result = await evaluateRequest("openid", [paymentRar()]);

      expect(result.approved).toBe(approved);
    }
  );

  it("holds a grant with a cooldown until the cooldown passes", async () => {
    await db
      .insert(agentSessionGrants)
      .values({
        capabilityName: "my_proofs",
        sessionId,
        source: "host_policy",
        status: "active",
        cooldownSec: 60,
        grantedAt: new Date(),
      })
      .run();

    const first = await evaluateRequest("openid proof:age");
    const second = await evaluateRequest("openid proof:age");

    expect(first.approved).toBe(true);
    expect(second).toEqual({
      approved: false,
      reason: "no grant constraints matched",
    });
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["a non-list value", '{"field":"amount.value","op":"max","value":1}'],
  ])(
    "refuses to evaluate a grant whose stored constraints are %s",
    async (_label, stored) => {
      const [grant] = await db
        .insert(agentSessionGrants)
        .values({
          capabilityName: "my_proofs",
          sessionId,
          source: "host_policy",
          status: "active",
          grantedAt: new Date(),
        })
        .returning({ id: agentSessionGrants.id });
      if (!grant) {
        throw new Error("Expected grant fixture to be created");
      }
      await db.run(
        sql`UPDATE agent_session_grant SET constraints_json = ${stored} WHERE id = ${grant.id}`
      );

      await expect(evaluateRequest("openid proof:age")).rejects.toThrow();
    }
  );

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

    const result = await evaluateRequest("openid proof:age", []);

    expect(result).toEqual(
      expect.objectContaining({
        approved: true,
        capabilityName: "my_proofs",
      })
    );
  });

  it("returns no matching capability for openid-only requests", async () => {
    const result = await evaluateRequest("openid", []);

    expect(result).toEqual({
      approved: false,
      reason:
        "request spans more than one capability or includes scopes no grant covers",
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
