import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { resetDatabase } from "@/test/db-test-utils";

const PAR_URL = "http://localhost:3000/api/auth/oauth2/par";
const CIMD_CLIENT_ID = "https://mcp-client.test/oauth";
const REDIRECT_URI = "https://mcp-client.test/callback";

function validMetadata(overrides?: Record<string, unknown>) {
  return {
    client_id: CIMD_CLIENT_ID,
    client_name: "MCP Test Client",
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code"],
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
      if (url === CIMD_CLIENT_ID) {
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

describe("CIMD: Client ID Metadata Document Resolution", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PAR endpoint with URL client_id", () => {
    it("resolves valid metadata and creates synthetic client", async () => {
      mockFetchMetadata(validMetadata());

      const { status } = await postPar({
        client_id: CIMD_CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });

      // PAR succeeds (client was resolved from metadata)
      expect(status).toBeLessThan(400);

      // Verify synthetic client was created in DB
      const client = await db.query.oauthClients.findFirst({
        where: (t, { eq }) => eq(t.clientId, CIMD_CLIENT_ID),
      });
      expect(client).toBeDefined();
      expect(client?.name).toBe("MCP Test Client");
      expect(client?.metadataUrl).toBe(CIMD_CLIENT_ID);
      expect(client?.metadataFetchedAt).toBeDefined();
      expect(client?.trustLevel).toBe(1);
      expect(client?.subjectType).toBe("pairwise");
      expect(client?.public).toBe(true);
    });

    it("rejects metadata with mismatched client_id", async () => {
      mockFetchMetadata(
        validMetadata({ client_id: "https://other.example.com" })
      );

      const { status, json } = await postPar({
        client_id: CIMD_CLIENT_ID,
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
        client_id: CIMD_CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
    });

    it("rejects metadata with disallowed grant_types", async () => {
      mockFetchMetadata(validMetadata({ grant_types: ["client_credentials"] }));

      const { status, json } = await postPar({
        client_id: CIMD_CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
      expect(json.error_description).toContain("grant_types");
    });

    it("rejects when metadata fetch fails", async () => {
      mockFetchMetadata(null); // network error

      const { status, json } = await postPar({
        client_id: CIMD_CLIENT_ID,
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
    it("uses cached client within TTL (no re-fetch)", async () => {
      // Pre-insert cached client
      await db.insert(oauthClients).values({
        clientId: CIMD_CLIENT_ID,
        name: "Cached MCP Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        tokenEndpointAuthMethod: "none",
        public: true,
        subjectType: "pairwise",
        trustLevel: 1,
        metadataUrl: CIMD_CLIENT_ID,
        metadataFetchedAt: new Date(), // fresh
      });

      // No fetch mock — should not need to fetch
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const realFetch = globalThis.fetch.bind(globalThis);
      fetchSpy.mockImplementation(
        (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url === CIMD_CLIENT_ID) {
            throw new Error("should not fetch — client is cached");
          }
          return realFetch(input, init);
        }
      );

      const { status } = await postPar({
        client_id: CIMD_CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });

      expect(status).toBeLessThan(400);
    });

    it("re-fetches metadata after TTL expires", async () => {
      // Insert client with expired TTL
      const pastTtl = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await db.insert(oauthClients).values({
        clientId: CIMD_CLIENT_ID,
        name: "Old Name",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        tokenEndpointAuthMethod: "none",
        public: true,
        subjectType: "pairwise",
        trustLevel: 1,
        metadataUrl: CIMD_CLIENT_ID,
        metadataFetchedAt: pastTtl,
      });

      mockFetchMetadata(validMetadata({ client_name: "Updated Name" }));

      const { status } = await postPar({
        client_id: CIMD_CLIENT_ID,
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
        where: (t, { eq }) => eq(t.clientId, CIMD_CLIENT_ID),
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
