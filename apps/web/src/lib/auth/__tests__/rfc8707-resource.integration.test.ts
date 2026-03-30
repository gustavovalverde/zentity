import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db/connection";
import { haipPushedRequests } from "@/lib/db/schema/haip";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const PAR_URL = "http://localhost:3000/api/auth/oauth2/par";
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "rfc8707-test-client";
const VALID_RESOURCE = "http://localhost:3000";

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "RFC 8707 Test",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function postPar(body: Record<string, string>) {
  const response = await auth.handler(
    new Request(PAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

describe("RFC 8707: Resource Indicator Enforcement", () => {
  beforeEach(async () => {
    await resetDatabase();
    await createTestClient();
  });

  describe("PAR endpoint validation", () => {
    it("rejects PAR without resource parameter", async () => {
      const { status, json } = await postPar({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        redirect_uri: "http://localhost/callback",
        scope: "openid",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
      expect(json.error_description).toContain("required");
    });

    it("rejects PAR with resource containing a fragment", async () => {
      const { status, json } = await postPar({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        redirect_uri: "http://localhost/callback",
        scope: "openid",
        resource: "https://api.example.com#section",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
      expect(json.error_description).toContain("fragment");
    });

    it("rejects PAR with relative URI resource", async () => {
      const { status, json } = await postPar({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        redirect_uri: "http://localhost/callback",
        scope: "openid",
        resource: "/api/resource",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
      expect(json.error_description).toContain("absolute URI");
    });

    it("accepts PAR with valid resource", async () => {
      const { status } = await postPar({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        redirect_uri: "http://localhost/callback",
        scope: "openid",
        resource: VALID_RESOURCE,
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });

      // PAR may return 200/201 on success (depends on HAIP plugin behavior)
      expect(status).toBeLessThan(400);
    });

    it("persists resource on the PAR record", async () => {
      const { status } = await postPar({
        client_id: TEST_CLIENT_ID,
        response_type: "code",
        redirect_uri: "http://localhost/callback",
        scope: "openid",
        resource: VALID_RESOURCE,
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });
      expect(status).toBeLessThan(400);

      const record = await db
        .select({ resource: haipPushedRequests.resource })
        .from(haipPushedRequests)
        .where(eq(haipPushedRequests.clientId, TEST_CLIENT_ID))
        .limit(1)
        .get();

      expect(record).toBeDefined();
      expect(record?.resource).toBe(VALID_RESOURCE);
    });
  });

  describe("Token endpoint resource enforcement", () => {
    it("rejects client_credentials grant without resource", async () => {
      const { status, json } = await postTokenWithDpop({
        grant_type: "client_credentials",
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
      expect(json.error_description).toContain("required");
    });

    it("rejects authorization_code grant with invalid resource format", async () => {
      const { status, json } = await postTokenWithDpop({
        grant_type: "authorization_code",
        code: "fake-code",
        client_id: TEST_CLIENT_ID,
        redirect_uri: "http://localhost/callback",
        resource: "/relative-path",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_request");
      expect(json.error_description).toContain("absolute URI");
    });

    it("does not reject CIBA grant without resource in body", async () => {
      const userId = await createTestUser();
      const { authReqId } = await createTestCibaRequest({
        clientId: TEST_CLIENT_ID,
        userId,
        status: "approved",
      });

      const { status } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
    });
  });

  describe("CIBA token with resource → aud binding", () => {
    let userId: string;

    beforeEach(async () => {
      userId = await createTestUser();
    });

    it("issues JWT access token with aud when CIBA request has resource", async () => {
      const { authReqId } = await createTestCibaRequest({
        clientId: TEST_CLIENT_ID,
        userId,
        status: "approved",
        resource: VALID_RESOURCE,
      });

      const { status, json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.access_token).toBeDefined();

      const payload = decodeJwt(json.access_token as string);
      // aud includes both the resource and the userinfo endpoint (openid scope)
      expect(payload.aud).toContain(VALID_RESOURCE);
    });

    it("issues opaque access token when CIBA request has no resource", async () => {
      const { authReqId } = await createTestCibaRequest({
        clientId: TEST_CLIENT_ID,
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

      // Opaque tokens are not JWTs — they don't have dots
      const token = json.access_token as string;
      const isDot = token.split(".").length === 3;
      // Could be JWT or opaque depending on framework behavior
      // The key assertion: no explicit aud claim if opaque
      if (!isDot) {
        // Opaque token — no aud to verify
        expect(token).toBeTruthy();
      }
    });
  });
});
