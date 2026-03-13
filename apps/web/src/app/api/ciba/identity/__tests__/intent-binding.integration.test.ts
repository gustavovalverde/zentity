import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

import { eq } from "drizzle-orm";

import { resetReleaseHandleStore } from "@/lib/auth/oidc/ephemeral-release-handles";
import { db } from "@/lib/db/connection";
import { approvals } from "@/lib/db/schema/approvals";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import { POST as intentRoute } from "../intent/route";
import { POST as stageRoute } from "../stage/route";

const TEST_CLIENT_ID = "intent-binding-agent";

function mockSession(userId: string) {
  authMocks.getSession.mockResolvedValue({ user: { id: userId } });
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Intent Binding Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function insertCibaRequest(
  overrides: Partial<typeof cibaRequests.$inferInsert> = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid identity.name",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

function makeRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("CIBA intent token authReqId binding", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetReleaseHandleStore();
    vi.clearAllMocks();
    userId = await createTestUser();
    await createTestClient();
  });

  it("intent token carries authReqId and stage verifies it", async () => {
    const authReqId = await insertCibaRequest({ userId });
    mockSession(userId);

    // Issue intent
    const intentRes = await intentRoute(
      makeRequest("http://localhost/api/ciba/identity/intent", {
        auth_req_id: authReqId,
        scopes: ["identity.name"],
      })
    );
    expect(intentRes.status).toBe(200);
    const { intent_token } = (await intentRes.json()) as {
      intent_token: string;
    };

    // Stage with matching authReqId succeeds
    const stageRes = await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: authReqId,
        scopes: ["identity.name"],
        identity: { given_name: "Ada", family_name: "Lovelace" },
        intent_token,
      })
    );
    expect(stageRes.status).toBe(200);
    const stageBody = (await stageRes.json()) as { staged: boolean };
    expect(stageBody.staged).toBe(true);
  });

  it("rejects intent token issued for a different auth_req_id", async () => {
    const reqA = await insertCibaRequest({ userId });
    const reqB = await insertCibaRequest({ userId });
    mockSession(userId);

    // Issue intent bound to request A
    const intentRes = await intentRoute(
      makeRequest("http://localhost/api/ciba/identity/intent", {
        auth_req_id: reqA,
        scopes: ["identity.name"],
      })
    );
    expect(intentRes.status).toBe(200);
    const { intent_token } = (await intentRes.json()) as {
      intent_token: string;
    };

    // Try to stage against request B — should fail
    const stageRes = await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: reqB,
        scopes: ["identity.name"],
        identity: { given_name: "Ada" },
        intent_token,
      })
    );
    expect(stageRes.status).toBe(400);
    const body = (await stageRes.json()) as { error: string };
    expect(body.error).toContain("different auth_req_id");
  });

  it("same client and scopes require distinct intent tokens per auth_req_id", async () => {
    const reqA = await insertCibaRequest({ userId });
    const reqB = await insertCibaRequest({ userId });
    mockSession(userId);

    // Get intent for A
    const intentA = await intentRoute(
      makeRequest("http://localhost/api/ciba/identity/intent", {
        auth_req_id: reqA,
        scopes: ["identity.name"],
      })
    );
    const tokenA = ((await intentA.json()) as { intent_token: string })
      .intent_token;

    // Get intent for B
    const intentB = await intentRoute(
      makeRequest("http://localhost/api/ciba/identity/intent", {
        auth_req_id: reqB,
        scopes: ["identity.name"],
      })
    );
    const tokenB = ((await intentB.json()) as { intent_token: string })
      .intent_token;

    // Token A works for A
    const stageA = await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: reqA,
        scopes: ["identity.name"],
        identity: { given_name: "Alice" },
        intent_token: tokenA,
      })
    );
    expect(stageA.status).toBe(200);

    // Token A fails for B
    const stageAforB = await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: reqB,
        scopes: ["identity.name"],
        identity: { given_name: "Bob" },
        intent_token: tokenA,
      })
    );
    expect(stageAforB.status).toBe(400);

    // Token B works for B
    const stageB = await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: reqB,
        scopes: ["identity.name"],
        identity: { given_name: "Bob" },
        intent_token: tokenB,
      })
    );
    expect(stageB.status).toBe(200);
  });
});

describe("CIBA authorization_details persistence", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetReleaseHandleStore();
    vi.clearAllMocks();
    userId = await createTestUser();
    await createTestClient();
  });

  it("persists authorization_details from CIBA request into approval row", async () => {
    const authDetails = JSON.stringify([
      { type: "payment", amount: "100.00", currency: "EUR" },
    ]);
    const authReqId = await insertCibaRequest({
      userId,
      authorizationDetails: authDetails,
    });
    mockSession(userId);

    // Issue intent
    const intentRes = await intentRoute(
      makeRequest("http://localhost/api/ciba/identity/intent", {
        auth_req_id: authReqId,
        scopes: ["identity.name"],
      })
    );
    const { intent_token } = (await intentRes.json()) as {
      intent_token: string;
    };

    // Stage
    await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: authReqId,
        scopes: ["identity.name"],
        identity: { given_name: "Ada" },
        intent_token,
      })
    );

    // Verify approval row has authorization_details
    const approval = await db
      .select()
      .from(approvals)
      .where(eq(approvals.authReqId, authReqId))
      .get();

    expect(approval).toBeDefined();
    expect(approval?.authorizationDetails).toBe(authDetails);
  });

  it("leaves authorization_details null when CIBA request has none", async () => {
    const authReqId = await insertCibaRequest({ userId });
    mockSession(userId);

    const intentRes = await intentRoute(
      makeRequest("http://localhost/api/ciba/identity/intent", {
        auth_req_id: authReqId,
        scopes: ["identity.name"],
      })
    );
    const { intent_token } = (await intentRes.json()) as {
      intent_token: string;
    };

    await stageRoute(
      makeRequest("http://localhost/api/ciba/identity/stage", {
        auth_req_id: authReqId,
        scopes: ["identity.name"],
        identity: { given_name: "Ada" },
        intent_token,
      })
    );

    const approval = await db
      .select()
      .from(approvals)
      .where(eq(approvals.authReqId, authReqId))
      .get();

    expect(approval).toBeDefined();
    expect(approval?.authorizationDetails).toBeNull();
  });
});
