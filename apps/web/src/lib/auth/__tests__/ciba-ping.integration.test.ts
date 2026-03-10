import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import { auth } from "../auth";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";
const TEST_CLIENT_ID = "ping-test-agent";
const TEST_NOTIFICATION_ENDPOINT = "http://localhost:9999/ciba/callback";
const TEST_NOTIFICATION_TOKEN = "ciba-ping-bearer-token-abc123";

async function createTestClient(
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Ping Test Agent",
      redirectUris: ["http://localhost/callback"],
      grantTypes: [CIBA_GRANT_TYPE],
      tokenEndpointAuthMethod: "none",
      public: true,
      ...overrides,
    })
    .run();
}

async function postBcAuthorize(
  body: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(BC_AUTHORIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      json =
        parsed && typeof parsed === "object" && "response" in parsed
          ? (parsed.response as Record<string, unknown>)
          : parsed;
    } catch {
      json = { raw: text };
    }
  }
  return { status: response.status, json };
}

async function postToken(
  body: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      json =
        parsed && typeof parsed === "object" && "response" in parsed
          ? (parsed.response as Record<string, unknown>)
          : parsed;
    } catch {
      json = { raw: text };
    }
  }
  return { status: response.status, json };
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
      deliveryMode: "ping",
      clientNotificationToken: TEST_NOTIFICATION_TOKEN,
      clientNotificationEndpoint: TEST_NOTIFICATION_ENDPOINT,
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    })
    .run();
  return authReqId;
}

describe("CIBA ping mode", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
  });

  describe("resolveClientNotificationEndpoint", () => {
    it("resolves notification endpoint from client metadata", async () => {
      await db
        .update(oauthClients)
        .set({
          metadata: {
            backchannel_client_notification_endpoint:
              TEST_NOTIFICATION_ENDPOINT,
          },
        })
        .where(eq(oauthClients.clientId, TEST_CLIENT_ID))
        .run();

      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: `user-${userId}@example.com`,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
      });

      expect(status).toBe(200);
      expect(json.auth_req_id).toBeDefined();

      // Verify the created request is in ping mode
      const request = await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqId, json.auth_req_id as string))
        .get();
      expect(request?.deliveryMode).toBe("ping");
      expect(request?.clientNotificationEndpoint).toBe(
        TEST_NOTIFICATION_ENDPOINT
      );
      expect(request?.clientNotificationToken).toBe(TEST_NOTIFICATION_TOKEN);
    });

    it("falls back to poll when no notification endpoint is resolvable", async () => {
      // Client has no metadata with notification endpoint
      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: `user-${userId}@example.com`,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
      });

      expect(status).toBe(200);

      const request = await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqId, json.auth_req_id as string))
        .get();
      expect(request?.deliveryMode).toBe("poll");
    });

    it("prefers client_notification_uri from request body over metadata", async () => {
      const bodyEndpoint = "http://localhost:8888/ciba/callback";
      await db
        .update(oauthClients)
        .set({
          metadata: {
            backchannel_client_notification_endpoint:
              TEST_NOTIFICATION_ENDPOINT,
          },
        })
        .where(eq(oauthClients.clientId, TEST_CLIENT_ID))
        .run();

      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: `user-${userId}@example.com`,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
        client_notification_uri: bodyEndpoint,
      });

      expect(status).toBe(200);

      const request = await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqId, json.auth_req_id as string))
        .get();
      expect(request?.deliveryMode).toBe("ping");
      expect(request?.clientNotificationEndpoint).toBe(bodyEndpoint);
    });
  });

  describe("ping-mode token retrieval", () => {
    it("allows polling for tokens on ping-mode requests (unlike push)", async () => {
      const authReqId = await insertCibaRequest({
        userId,
        status: "approved",
      });

      const { status, json } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.access_token).toBeDefined();
      expect(json.token_type).toBeDefined();
    });

    it("returns authorization_pending for pending ping-mode requests", async () => {
      const authReqId = await insertCibaRequest({
        userId,
        status: "pending",
      });

      const { status, json } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("authorization_pending");
    });
  });

  describe("bc-authorize ping-mode request creation", () => {
    it("stores notification token and endpoint for ping-mode requests", async () => {
      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: `user-${userId}@example.com`,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
        client_notification_uri: TEST_NOTIFICATION_ENDPOINT,
      });

      expect(status).toBe(200);
      expect(json.auth_req_id).toBeDefined();

      const request = await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqId, json.auth_req_id as string))
        .get();

      expect(request?.deliveryMode).toBe("ping");
      expect(request?.clientNotificationToken).toBe(TEST_NOTIFICATION_TOKEN);
      expect(request?.clientNotificationEndpoint).toBe(
        TEST_NOTIFICATION_ENDPOINT
      );
    });
  });

  describe("poll-mode regression", () => {
    it("poll-mode requests still work without notification fields", async () => {
      const authReqId = await insertCibaRequest({
        userId,
        status: "approved",
        deliveryMode: "poll",
        clientNotificationToken: null,
        clientNotificationEndpoint: null,
      });

      const { status, json } = await postToken({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.access_token).toBeDefined();
    });
  });

  describe("missing client_notification_token", () => {
    it("falls back to poll when notification token is absent", async () => {
      await db
        .update(oauthClients)
        .set({
          metadata: {
            backchannel_client_notification_endpoint:
              TEST_NOTIFICATION_ENDPOINT,
          },
        })
        .where(eq(oauthClients.clientId, TEST_CLIENT_ID))
        .run();

      // No client_notification_token → should stay in poll mode
      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: `user-${userId}@example.com`,
      });

      expect(status).toBe(200);

      const request = await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqId, json.auth_req_id as string))
        .get();
      expect(request?.deliveryMode).toBe("poll");
    });
  });
});
