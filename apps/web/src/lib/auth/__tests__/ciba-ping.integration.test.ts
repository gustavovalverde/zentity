import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestSession,
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

import { auth } from "../auth-config";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const AUTH_URL = "http://localhost:3000/api/auth";
const TEST_CLIENT_ID = "ping-test-agent";
// Ping endpoints must be public https URLs; the client registers one.
const TEST_NOTIFICATION_ENDPOINT = "https://rp.example.com/ciba/callback";
const TEST_NOTIFICATION_TOKEN = "ciba-ping-bearer-token-abc123";

async function createTestClient(metadata: Record<string, unknown>) {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Ping Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      metadata: JSON.stringify(metadata),
    })
    .run();
}

const PING_METADATA = {
  backchannel_token_delivery_mode: "ping",
  backchannel_client_notification_endpoint: TEST_NOTIFICATION_ENDPOINT,
};

async function postBcAuthorize(
  body: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await auth.handler(
    new Request(`${AUTH_URL}/oauth2/bc-authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function findRequest(rawAuthReqId: string) {
  return db
    .select()
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(rawAuthReqId)))
    .get();
}

describe("CIBA ping mode", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("bc-authorize", () => {
    it("records the registered notification endpoint and encrypted ping credentials", async () => {
      await createTestClient(PING_METADATA);

      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: userId,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
      });

      expect(status).toBe(200);
      const request = await findRequest(json.auth_req_id as string);
      expect(request?.clientNotificationEndpoint).toBe(
        TEST_NOTIFICATION_ENDPOINT
      );
      // The token and auth_req_id are kept only in encrypted form.
      expect(request?.encryptedClientNotificationToken).toBeTruthy();
      expect(request?.encryptedClientNotificationToken).not.toContain(
        TEST_NOTIFICATION_TOKEN
      );
      expect(request?.encryptedAuthReqId).toBeTruthy();
    });

    it("keeps no ping state for a poll-registered client", async () => {
      await createTestClient({ backchannel_token_delivery_mode: "poll" });

      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: userId,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
      });

      expect(status).toBe(200);
      const request = await findRequest(json.auth_req_id as string);
      expect(request?.clientNotificationEndpoint).toBeNull();
      expect(request?.encryptedClientNotificationToken).toBeNull();
    });

    it("rejects a ping request that omits the notification token", async () => {
      await createTestClient(PING_METADATA);

      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: userId,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
    });

    it("refuses a client whose stored metadata is malformed", async () => {
      await db
        .insert(oauthClients)
        .values({
          clientId: TEST_CLIENT_ID,
          redirectUris: JSON.stringify(["http://localhost/callback"]),
          grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
          tokenEndpointAuthMethod: "none",
          metadata: "{not valid json",
        })
        .run();

      const { status, json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: userId,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
      });

      // Malformed stored metadata fails as a client error, never a 500.
      expect(status).toBeLessThan(500);
      expect(json.error).toBeDefined();
    });
  });

  describe("token polling", () => {
    it("lets a ping-mode client poll for its tokens", async () => {
      await createTestClient(PING_METADATA);
      const { authReqId } = await createTestCibaRequest({
        clientId: TEST_CLIENT_ID,
        userId,
        status: "approved",
        clientNotificationEndpoint: TEST_NOTIFICATION_ENDPOINT,
      });

      const { status, json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.access_token).toBeDefined();
      expect(json.token_type).toBe("DPoP");
    });

    it("returns authorization_pending before the user decides", async () => {
      await createTestClient(PING_METADATA);
      const { authReqId } = await createTestCibaRequest({
        clientId: TEST_CLIENT_ID,
        userId,
        status: "pending",
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

  describe("ping callback", () => {
    it("pings the registered endpoint once the user approves", async () => {
      await createTestClient(PING_METADATA);
      const pings: { authorization: string | null; body: unknown }[] = [];
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === TEST_NOTIFICATION_ENDPOINT) {
          pings.push({
            authorization: new Headers(init?.headers).get("authorization"),
            body: JSON.parse(String(init?.body)),
          });
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return realFetch(input, init);
      });

      const { json } = await postBcAuthorize({
        client_id: TEST_CLIENT_ID,
        scope: "openid",
        login_hint: userId,
        client_notification_token: TEST_NOTIFICATION_TOKEN,
      });
      const authReqId = json.auth_req_id as string;
      const request = await findRequest(authReqId);

      const { token } = await createTestSession(userId);
      const signed = `${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
      const decision = await auth.handler(
        new Request(`${AUTH_URL}/ciba/decision`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `better-auth.session_token=${signed}`,
          },
          body: JSON.stringify({
            request_id: request?.id,
            decision: "approved",
          }),
        })
      );

      expect(decision.status).toBe(200);
      expect(pings).toEqual([
        {
          authorization: `Bearer ${TEST_NOTIFICATION_TOKEN}`,
          body: { auth_req_id: authReqId },
        },
      ]);
    });
  });
});
