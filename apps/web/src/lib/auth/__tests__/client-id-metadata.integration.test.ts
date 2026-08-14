import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { resetDatabase } from "@/test-utils/db-test-utils";

const PAR_URL = "http://localhost:3000/api/auth/oauth2/par";
const CIMD_CLIENT_ID_BASE = "https://mcp-client.test/oauth";
const REDIRECT_URI = "https://mcp-client.test/callback";
let cimdClientId = CIMD_CLIENT_ID_BASE;
let testClientSequence = 0;

function validMetadata(overrides?: Record<string, unknown>) {
  return {
    client_id: cimdClientId,
    client_name: "MCP Test Client",
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    application_type: "native",
    token_endpoint_auth_method: "none",
    ...overrides,
  };
}

function mockFetchMetadata(
  metadata: Record<string, unknown> | null,
  status = 200
) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === cimdClientId) {
        if (metadata === null) {
          return Promise.reject(new Error("network error"));
        }
        return Promise.resolve(
          new Response(JSON.stringify(metadata), {
            status,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return realFetch(input, init);
    }
  );
}

async function postPar(body: Record<string, string>) {
  const response = await auth.handler(
    new Request(PAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
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

describe("CIMD: Client ID Metadata Document Resolution", () => {
  beforeEach(async () => {
    testClientSequence += 1;
    cimdClientId = `${CIMD_CLIENT_ID_BASE}/${testClientSequence}`;
    await resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PAR endpoint with URL client_id", () => {
    it("resolves valid metadata and creates synthetic client", async () => {
      mockFetchMetadata(validMetadata());

      const { status } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });

      expect(status).toBe(201);

      // Verify synthetic client was created in DB
      const client = await db.query.oauthClients.findFirst({
        where: (t, { eq }) => eq(t.clientId, cimdClientId),
      });
      expect(client).toBeDefined();
      expect(client?.name).toBe("MCP Test Client");
      expect(client?.metadataUrl).toBe(cimdClientId);
      expect(client?.metadataFetchedAt).toBeDefined();
      expect(client?.trustLevel).toBe(1);
      expect(client?.subjectType).toBe("pairwise");
      expect(client?.clientDiscoveryId).toBe("cimd");
      expect(client?.applicationType).toBe("native");
    });

    it("rejects metadata with mismatched client_id", async () => {
      mockFetchMetadata(
        validMetadata({ client_id: "https://other.example.com" })
      );

      const { status, json } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
      expect(json.error_description).toContain("does not match");
    });

    it("rejects metadata with missing redirect_uris", async () => {
      mockFetchMetadata(validMetadata({ redirect_uris: undefined }));

      const { status, json } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
    });

    it("rejects PAR when the discovered client lacks authorization_code", async () => {
      mockFetchMetadata(
        validMetadata({
          grant_types: ["client_credentials"],
          response_types: undefined,
        })
      );

      const { status, json } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("unauthorized_client");
      expect(json.error_description).toContain("authorization_code");
    });

    it("rejects when metadata fetch fails", async () => {
      mockFetchMetadata(null); // network error

      const { status, json } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
    });

    it("rejects SSRF: private IP in client_id URL", async () => {
      const { status, json } = await postPar({
        client_id: "https://192.168.1.1/oauth",
        response_type: "code",
        redirect_uri: "https://192.168.1.1/callback",
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
      expect(json.error_description).toContain("private");
    });
  });

  describe("cache behavior", () => {
    it("reuses validated metadata from the in-memory cache", async () => {
      mockFetchMetadata(validMetadata());
      const request = {
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      };

      expect((await postPar(request)).status).toBe(201);
      expect((await postPar(request)).status).toBe(201);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("re-fetches a discovery-owned client after an in-memory cache restart", async () => {
      // A persisted discovery-owned row has no validated response cache after a
      // process restart, so CIMD must re-fetch and revalidate its document.
      const pastTtl = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await db.insert(oauthClients).values({
        clientId: cimdClientId,
        name: "Old Name",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        applicationType: "native",
        clientDiscoveryId: "cimd",
        subjectType: "pairwise",
        trustLevel: 1,
        metadataUrl: cimdClientId,
        metadataFetchedAt: pastTtl,
        createdAt: pastTtl,
        updatedAt: pastTtl,
      });

      mockFetchMetadata(validMetadata({ client_name: "Updated Name" }));

      const { status } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });

      expect(status).toBeLessThan(400);

      // Verify client was updated
      const client = await db.query.oauthClients.findFirst({
        where: (t, { eq }) => eq(t.clientId, cimdClientId),
      });
      expect(client?.name).toBe("Updated Name");
    });
  });

  describe("non-URL client_id passthrough", () => {
    it("does not trigger CIMD for regular client_id", async () => {
      // Create a normal client
      await db.insert(oauthClients).values({
        clientId: "regular-client",
        name: "Regular Client",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify(["authorization_code"]),
        tokenEndpointAuthMethod: "none",
        public: true,
      });

      const { status } = await postPar({
        client_id: "regular-client",
        response_type: "code",
        redirect_uri: "http://localhost/callback",
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });

      expect(status).toBeLessThan(400);
    });
  });
});
