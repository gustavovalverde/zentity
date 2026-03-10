import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  resetReleaseHandleStore,
  stageReleaseHandle,
} from "@/lib/auth/oidc/ephemeral-release-handles";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "ciba-test-agent";
// Resource must match a validAudiences entry so the access token is JWT (not opaque)
const TEST_RESOURCE = "http://localhost:3000/api/auth";

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "CIBA Test Agent",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [CIBA_GRANT_TYPE],
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
      scope: "openid",
      status: "pending",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

describe("CIBA token endpoint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetReleaseHandleStore();
    userId = await createTestUser();
    await createTestClient();
  });

  it("returns authorization_pending for a pending request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "pending" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("authorization_pending");
  });

  it("returns access_denied for a rejected request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "rejected" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("access_denied");
  });

  it("returns expired_token for an expired request", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("expired_token");
  });

  it("returns tokens for an approved request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
    expect(typeof json.access_token).toBe("string");
    expect(json.token_type).toBe("DPoP");
    expect(json.expires_in).toBeDefined();
  });

  it("includes act claim in access token JWT", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const payload = decodeJwt(json.access_token as string);
    expect(payload.act).toEqual({ sub: TEST_CLIENT_ID });
  });

  it("forwards authorization_details to token and response", async () => {
    const authorizationDetails = JSON.stringify([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resource: TEST_RESOURCE,
      authorizationDetails,
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    // authorization_details in token response body (RFC 9396 §7)
    expect(json.authorization_details).toEqual([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);

    // authorization_details embedded in access token JWT
    const payload = decodeJwt(json.access_token as string);
    expect(payload.authorization_details).toEqual([
      {
        type: "purchase",
        merchant: "Test Store",
        item: "Widget",
        amount: { currency: "USD", value: "9.99" },
      },
    ]);
  });

  it("omits authorization_details when CIBA request has none", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(json.authorization_details).toBeUndefined();
  });

  it("deletes CIBA request after successful token issuance (replay prevention)", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    // First poll succeeds
    const { status } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    // Second poll with same auth_req_id should fail
    const { status: replayStatus, json: replayJson } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(replayStatus).toBe(400);
    expect(replayJson.error).toBe("invalid_grant");
  });

  it("returns slow_down when polled too frequently", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      pollingInterval: 5,
      lastPolledAt: Date.now(),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("slow_down");
  });

  it("rejects when client_id does not match CIBA request", async () => {
    await db
      .insert(oauthClients)
      .values({
        clientId: "other-agent",
        name: "Other Agent",
        redirectUris: ["http://localhost/callback"],
        grantTypes: [CIBA_GRANT_TYPE],
        tokenEndpointAuthMethod: "none",
        public: true,
      })
      .run();

    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: "other-agent",
    });

    expect(status).toBe(400);
    expect(json.error).toBe("invalid_grant");
  });

  describe("release handle in access token", () => {
    it("embeds release_handle when staged before token minting", async () => {
      const authReqId = await insertCibaRequest({
        userId,
        status: "approved",
        resource: TEST_RESOURCE,
      });

      const fakeHandle = crypto.randomBytes(32).toString("base64url");
      stageReleaseHandle(userId, fakeHandle);

      const { json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      const payload = decodeJwt(json.access_token as string);
      expect(payload.release_handle).toBe(fakeHandle);
    });

    it("omits release_handle when nothing is staged", async () => {
      const authReqId = await insertCibaRequest({
        userId,
        status: "approved",
        resource: TEST_RESOURCE,
      });

      const { json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      const payload = decodeJwt(json.access_token as string);
      expect(payload.release_handle).toBeUndefined();
    });
  });
});
