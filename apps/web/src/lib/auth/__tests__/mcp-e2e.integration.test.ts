import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth";
import { enrichDiscoveryMetadata } from "@/lib/auth/well-known-utils";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import { postTokenWithDpop } from "@/test/dpop-test-utils";

const BASE = "http://localhost:3000";
const PAR_URL = `${BASE}/api/auth/oauth2/par`;
const CIMD_CLIENT_ID = "https://mcp-e2e.test/oauth";
const REDIRECT_URI = "https://mcp-e2e.test/callback";
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

function validCimdMetadata() {
  return {
    client_id: CIMD_CLIENT_ID,
    client_name: "MCP E2E Client",
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code"],
    token_endpoint_auth_method: "none",
  };
}

function mockCimdFetch() {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === CIMD_CLIENT_ID) {
        return Promise.resolve(
          new Response(JSON.stringify(validCimdMetadata()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return realFetch(input, init);
    }
  );
}

describe("MCP End-to-End: Discovery → CIMD → Resource-Bound Tokens", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AS discovery metadata", () => {
    it("includes CIMD and resource indicator support", async () => {
      const rawMeta = await auth.api.getOpenIdConfig();
      const meta = enrichDiscoveryMetadata(rawMeta as Record<string, unknown>);
      expect(meta.client_id_metadata_document_supported).toBe(true);
      expect(meta.resource_indicators_supported).toBe(true);
    });
  });

  describe("CIMD → PAR → synthetic client", () => {
    it("fetches CIMD, creates pairwise client, and accepts PAR", async () => {
      mockCimdFetch();

      const parResponse = await auth.handler(
        new Request(PAR_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: CIMD_CLIENT_ID,
            response_type: "code",
            redirect_uri: REDIRECT_URI,
            scope: "openid",
            resource: BASE,
            code_challenge: "test-challenge",
            code_challenge_method: "S256",
          }),
        })
      );

      expect(parResponse.status).toBeLessThan(400);

      const client = await db.query.oauthClients.findFirst({
        where: (t, { eq }) => eq(t.clientId, CIMD_CLIENT_ID),
      });
      expect(client).toBeDefined();
      expect(client?.subjectType).toBe("pairwise");
      expect(client?.trustLevel).toBe(0);
      expect(client?.metadataUrl).toBe(CIMD_CLIENT_ID);
    });
  });

  describe("Resource-bound token via CIBA with CIMD client", () => {
    let userId: string;

    beforeEach(async () => {
      userId = await createTestUser();
      await db.insert(oauthClients).values({
        clientId: CIMD_CLIENT_ID,
        name: "MCP E2E Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
        tokenEndpointAuthMethod: "none",
        public: true,
        subjectType: "pairwise",
        trustLevel: 0,
        metadataUrl: CIMD_CLIENT_ID,
        metadataFetchedAt: new Date(),
      });
    });

    it("issues JWT access token with aud + DPoP binding", async () => {
      const authReqId = crypto.randomUUID();
      await db
        .insert(cibaRequests)
        .values({
          authReqId,
          clientId: CIMD_CLIENT_ID,
          userId,
          scope: "openid",
          status: "approved",
          resource: BASE,
          expiresAt: new Date(Date.now() + 300_000),
        })
        .run();

      const { status, json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: CIMD_CLIENT_ID,
      });

      expect(status).toBe(200);
      expect(json.access_token).toBeDefined();

      const payload = decodeJwt(json.access_token as string);
      // aud bound to resource
      expect(payload.aud).toContain(BASE);
      // DPoP cnf.jkt present
      expect(payload.cnf).toBeDefined();
      expect((payload.cnf as Record<string, string>).jkt).toBeDefined();
    });
  });
});
