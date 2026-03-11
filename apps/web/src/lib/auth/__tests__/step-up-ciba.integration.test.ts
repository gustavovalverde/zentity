import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { identityBundles } from "@/lib/db/schema/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "step-up-ciba-test";
const FPA_CLIENT_ID = "step-up-ciba-fpa-test";
const APPROVE_URL = "http://localhost:3000/api/auth/ciba/authorize";

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Step-Up CIBA Test",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [CIBA_GRANT_TYPE],
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createFirstPartyClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: FPA_CLIENT_ID,
      name: "Step-Up CIBA FPA Test",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [CIBA_GRANT_TYPE],
      tokenEndpointAuthMethod: "none",
      public: true,
      firstParty: true,
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
      scope: "openid",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

async function insertSession(userId: string) {
  const token = crypto.randomUUID();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginMethod: "passkey",
    })
    .run();
  return token;
}

async function seedTier1User(userId: string) {
  await db
    .insert(identityBundles)
    .values({
      userId,
      fheKeyId: "test-fhe-key-id",
      fheStatus: "complete",
      status: "verified",
    })
    .run();
}

function approveRequest(authReqId: string, sessionToken: string) {
  return auth.handler(
    new Request(APPROVE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `better-auth.session_token=${sessionToken}`,
      },
      body: JSON.stringify({ auth_req_id: authReqId }),
    })
  );
}

describe("CIBA step-up: acr_values at approval time", () => {
  let userId: string;
  let sessionToken: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
    sessionToken = await insertSession(userId);
  });

  it("tier-1 user cannot approve CIBA request requiring tier-2", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: "urn:zentity:assurance:tier-2",
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("tier-1");
    expect(body.message).toContain("urn:zentity:assurance:tier-2");
  });

  it("tier-0 user cannot approve CIBA request requiring tier-1", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: "urn:zentity:assurance:tier-1",
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("tier-0");
  });

  it("tier-1 user can approve CIBA request requiring tier-1", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: "urn:zentity:assurance:tier-1",
    });

    const response = await approveRequest(authReqId, sessionToken);

    // Should succeed (200) or proceed to the plugin handler
    expect(response.status).not.toBe(403);
  });

  it("higher tier satisfies lower requirement", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: "urn:zentity:assurance:tier-0",
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).not.toBe(403);
  });

  it("no acr_values passes without enforcement", async () => {
    const authReqId = await insertCibaRequest({ userId });

    const response = await approveRequest(authReqId, sessionToken);

    // Should pass through to the plugin handler (not blocked by our hook)
    expect(response.status).not.toBe(403);
  });

  it("preference order: first satisfiable ACR wins", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: "urn:zentity:assurance:tier-3 urn:zentity:assurance:tier-1",
    });

    const response = await approveRequest(authReqId, sessionToken);

    // tier-1 satisfies the second value, should not be rejected
    expect(response.status).not.toBe(403);
  });
});

describe("CIBA step-up: acr_values at token exchange (safety net)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  it("approved request with unsatisfied acr_values returns interaction_required", async () => {
    // Tier-0 user with approved request requiring tier-2
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      acrValues: "urn:zentity:assurance:tier-2",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.error_description).toContain("tier-0");
  });

  it("approved request with satisfied acr_values issues tokens", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      acrValues: "urn:zentity:assurance:tier-1",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
  });

  it("no acr_values on CIBA request bypasses safety net", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
  });

  it("pending request with acr_values still returns authorization_pending", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      acrValues: "urn:zentity:assurance:tier-2",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("authorization_pending");
  });
});

describe("CIBA step-up: first-party client (FPA) path", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createFirstPartyClient();
  });

  it("FPA client with unsatisfied acr_values returns 403 + auth_session", async () => {
    const authReqId = await insertCibaRequest({
      clientId: FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: "urn:zentity:assurance:tier-2",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: FPA_CLIENT_ID,
    });

    expect(status).toBe(403);
    expect(json.error).toBe("insufficient_authorization");
    expect(json.auth_session).toBeTypeOf("string");
    expect(json.error_description).toContain("tier-0");
  });

  it("non-FPA client with unsatisfied acr_values still returns 400 interaction_required", async () => {
    await createTestClient();
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      acrValues: "urn:zentity:assurance:tier-2",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.auth_session).toBeUndefined();
  });

  it("FPA client with satisfied acr_values issues tokens normally", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      clientId: FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: "urn:zentity:assurance:tier-1",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: FPA_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
  });
});
