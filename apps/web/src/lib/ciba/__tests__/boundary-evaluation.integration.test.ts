import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  evaluateBoundaries,
  normalizeAuthorizationDetails,
} from "@/lib/ciba/boundary-evaluation";
import { db } from "@/lib/db/connection";
import { agentBoundaries } from "@/lib/db/schema/agent-boundaries";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "boundary-test-agent";

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Boundary Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createBoundary(
  userId: string,
  type: string,
  config: Record<string, unknown>,
  enabled = true
) {
  await db
    .insert(agentBoundaries)
    .values({
      userId,
      clientId: TEST_CLIENT_ID,
      boundaryType: type,
      config: JSON.stringify(config),
      enabled,
    })
    .run();
}

async function insertAutoApprovedRequest(userId: string, authDetails?: string) {
  const authReqId = crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId,
      scope: "openid",
      status: "approved",
      approvalMethod: "boundary",
      authorizationDetails: authDetails ?? null,
      expiresAt: new Date(Date.now() + 300_000),
    })
    .run();
  return authReqId;
}

const PURCHASE_30_USD = [
  { type: "purchase", amount: { value: "30", currency: "USD" } },
];
const PURCHASE_10_USD = [
  { type: "purchase", amount: { value: "10", currency: "USD" } },
];
const PURCHASE_20_USD = [
  { type: "purchase", amount: { value: "20", currency: "USD" } },
];
const PURCHASE_75_USD = [
  { type: "purchase", amount: { value: "75", currency: "USD" } },
];

describe("boundary evaluation", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("returns false when no boundaries configured", async () => {
    const result = await evaluateBoundaries(
      userId,
      TEST_CLIENT_ID,
      "openid",
      []
    );
    expect(result.autoApproved).toBe(false);
    expect(result.reason).toBe("no boundaries configured");
  });

  it("returns false for identity scopes regardless of boundaries", async () => {
    await createBoundary(userId, "scope", {
      allowedScopes: ["identity.name"],
    });
    const result = await evaluateBoundaries(
      userId,
      TEST_CLIENT_ID,
      "openid identity.name",
      []
    );
    expect(result.autoApproved).toBe(false);
    expect(result.reason).toBe("identity scopes require manual approval");
  });

  describe("purchase boundary", () => {
    it("auto-approves within limits", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid",
        PURCHASE_30_USD
      );
      expect(result.autoApproved).toBe(true);
    });

    it("rejects when amount exceeds max", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid",
        PURCHASE_75_USD
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toContain("exceeds max");
    });

    it("rejects when daily cap would be exceeded", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 100,
        currency: "USD",
        dailyCap: 50,
        cooldownMinutes: 0,
      });
      await insertAutoApprovedRequest(
        userId,
        JSON.stringify([
          { type: "purchase", amount: { value: "40", currency: "USD" } },
        ])
      );
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid",
        PURCHASE_20_USD
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toContain("daily cap");
    });

    it("rejects during cooldown period", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 100,
        currency: "USD",
        dailyCap: 500,
        cooldownMinutes: 30,
      });
      await insertAutoApprovedRequest(userId);
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid",
        PURCHASE_10_USD
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toBe("cooldown period active");
    });

    it("does NOT auto-approve when no authorization_details (no match)", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid",
        []
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toBe("no matching boundary");
    });
  });

  describe("scope boundary", () => {
    it("auto-approves when all scopes allowed", async () => {
      await createBoundary(userId, "scope", {
        allowedScopes: ["proof:age", "proof:nationality"],
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid proof:age",
        []
      );
      expect(result.autoApproved).toBe(true);
    });

    it("rejects disallowed scopes", async () => {
      await createBoundary(userId, "scope", {
        allowedScopes: ["proof:age"],
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid proof:age proof:nationality",
        []
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toContain("disallowed scopes");
    });
  });

  describe("match semantics", () => {
    it("purchase + scope: scope matches, purchase doesn't → auto-approved", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      });
      await createBoundary(userId, "scope", {
        allowedScopes: ["proof:age"],
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid proof:age",
        []
      );
      expect(result.autoApproved).toBe(true);
    });

    it("purchase + scope: both match, purchase fails → rejected", async () => {
      await createBoundary(userId, "purchase", {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      });
      await createBoundary(userId, "scope", {
        allowedScopes: ["proof:age"],
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid proof:age",
        PURCHASE_75_USD
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toContain("exceeds max");
    });

    it("custom boundary doesn't match without matching action type → no match", async () => {
      await createBoundary(userId, "custom", {
        actionType: "book_flight",
        dailyCount: 5,
      });
      const result = await evaluateBoundaries(
        userId,
        TEST_CLIENT_ID,
        "openid",
        [{ type: "purchase", amount: { value: "10", currency: "USD" } }]
      );
      expect(result.autoApproved).toBe(false);
      expect(result.reason).toBe("no matching boundary");
    });
  });

  it("ignores disabled boundaries", async () => {
    await createBoundary(
      userId,
      "purchase",
      {
        maxAmount: 50,
        currency: "USD",
        dailyCap: 200,
        cooldownMinutes: 0,
      },
      false
    );
    const result = await evaluateBoundaries(
      userId,
      TEST_CLIENT_ID,
      "openid",
      PURCHASE_10_USD
    );
    expect(result.autoApproved).toBe(false);
    expect(result.reason).toBe("no boundaries configured");
  });

  it("requires ALL matching boundaries to pass (AND logic)", async () => {
    await createBoundary(userId, "purchase", {
      maxAmount: 50,
      currency: "USD",
      dailyCap: 200,
      cooldownMinutes: 0,
    });
    await createBoundary(userId, "scope", {
      allowedScopes: ["proof:age"],
    });
    // Purchase matches and passes, scope matches but fails
    const result = await evaluateBoundaries(
      userId,
      TEST_CLIENT_ID,
      "openid proof:nationality",
      PURCHASE_10_USD
    );
    expect(result.autoApproved).toBe(false);
  });

  describe("normalizeAuthorizationDetails", () => {
    it("accepts a parsed array", () => {
      const input = [{ type: "purchase", amount: { value: "10" } }];
      expect(normalizeAuthorizationDetails(input)).toEqual(input);
    });

    it("parses a JSON string", () => {
      const input = JSON.stringify([{ type: "purchase" }]);
      expect(normalizeAuthorizationDetails(input)).toEqual([
        { type: "purchase" },
      ]);
    });

    it("returns empty array for null", () => {
      expect(normalizeAuthorizationDetails(null)).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      expect(normalizeAuthorizationDetails(undefined)).toEqual([]);
    });

    it("returns empty array for invalid JSON string", () => {
      expect(normalizeAuthorizationDetails("not-json")).toEqual([]);
    });
  });
});
