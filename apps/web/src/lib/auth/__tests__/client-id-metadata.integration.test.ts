import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { redeemTestAuthorizationCode } from "@/test-utils/authorization-code-test-utils";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

vi.mock("@better-auth/cimd/node", () => ({
  fetchClientMetadataResource: (input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init),
}));

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

    it("creates a client with a loopback post-logout redirect, without logout", async () => {
      mockFetchMetadata(
        validMetadata({
          post_logout_redirect_uris: ["http://127.0.0.1:8123/signed-out"],
        })
      );

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
      const client = await db.query.oauthClients.findFirst({
        where: (t, { eq }) => eq(t.clientId, cimdClientId),
      });
      expect(client).toBeDefined();
      expect(client?.enableEndSession).toBeFalsy();
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

  describe("pairwise sector", () => {
    const RP_REDIRECT_URI = "https://rp.example/callback";
    const RP_CLIENT_ID = "registered-rp";

    async function idTokenSub(
      clientId: string,
      redirectUri: string,
      userId: string
    ) {
      const { status, json } = await redeemTestAuthorizationCode({
        clientId,
        redirectUri,
        userId,
      });
      if (status !== 200) {
        throw new Error(`token request failed: ${JSON.stringify(json)}`);
      }
      return decodeJwt(json.id_token as string).sub;
    }

    async function storedSector() {
      const client = await db.query.oauthClients.findFirst({
        where: (t, { eq }) => eq(t.clientId, cimdClientId),
      });
      return client?.sectorIdentifier;
    }

    // The document names the other relying party's host first and its own
    // second.
    function claimingMetadata() {
      return validMetadata({
        redirect_uris: [RP_REDIRECT_URI, REDIRECT_URI],
      });
    }

    /** A discovery-owned row whose document is due for a refresh. */
    async function insertStaleClient(sectorIdentifier: string) {
      const pastTtl = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await db.insert(oauthClients).values({
        clientId: cimdClientId,
        name: "MCP Test Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        applicationType: "native",
        clientDiscoveryId: "cimd",
        subjectType: "pairwise",
        sectorIdentifier,
        trustLevel: 1,
        metadataUrl: cimdClientId,
        metadataFetchedAt: pastTtl,
        createdAt: pastTtl,
        updatedAt: pastTtl,
      });
    }

    /** Makes Zentity's posture write fail; the provider's own writes pass. */
    function failPostureWrite() {
      const update = db.update.bind(db);
      vi.spyOn(db, "update").mockImplementation(((
        table: typeof oauthClients
      ) => {
        const builder = update(table);
        const set = builder.set.bind(builder);
        builder.set = ((values: Record<string, unknown>) => {
          if ("trustLevel" in values) {
            throw new Error("posture write failed");
          }
          return set(values);
        }) as typeof builder.set;
        return builder;
      }) as typeof db.update);
    }

    let userId: string;

    beforeEach(async () => {
      userId = await createTestUser();
      await db.insert(oauthClients).values({
        clientId: RP_CLIENT_ID,
        name: "Registered RP",
        redirectUris: JSON.stringify([RP_REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        subjectType: "pairwise",
        sectorIdentifier: "rp.example",
      });
    });

    it("gives a created client its own sector, not the first redirect host", async () => {
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
      expect(await storedSector()).toBe(`client/${cimdClientId}`);
    });

    it("refuses a document that names another origin's redirect URI", async () => {
      mockFetchMetadata(claimingMetadata());
      const { status, json } = await postPar({
        client_id: cimdClientId,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "openid",
        resource: "http://localhost:3000",
        code_challenge: "test-challenge",
        code_challenge_method: "S256",
      });
      expect(status).toBe(400);
      expect(json.error).toBe("invalid_client");
      expect(json.error_description).toContain("same origin as client_id");
      expect(await storedSector()).toBeUndefined();
    });

    it("accepts loopback redirect URIs beside its own origin", async () => {
      mockFetchMetadata(
        validMetadata({
          redirect_uris: ["http://127.0.0.1:8123/callback", REDIRECT_URI],
        })
      );
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
      expect(await storedSector()).toBe(`client/${cimdClientId}`);
    });

    it("keeps its own sector through a refresh during a token request", async () => {
      // The provider's derivation, stored by the refresh before the posture.
      await insertStaleClient("mcp-client.test");
      mockFetchMetadata(validMetadata());

      const cimdSub = await idTokenSub(cimdClientId, REDIRECT_URI, userId);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        cimdClientId,
        expect.anything()
      );
      expect(await storedSector()).toBe(`client/${cimdClientId}`);
      expect(cimdSub).not.toBe(
        await idTokenSub(RP_CLIENT_ID, RP_REDIRECT_URI, userId)
      );
    });

    it("refuses a refreshed document that names another origin's redirect URI", async () => {
      await insertStaleClient(`client/${cimdClientId}`);
      mockFetchMetadata(claimingMetadata());

      const { status, json } = await redeemTestAuthorizationCode({
        clientId: cimdClientId,
        redirectUri: REDIRECT_URI,
        userId,
      });
      expect(status).toBe(400);
      expect(json.error_description).toContain("same origin as client_id");
      expect(await storedSector()).toBe(`client/${cimdClientId}`);
    });

    it("refuses the request when the posture cannot be stored", async () => {
      await insertStaleClient(`client/${cimdClientId}`);
      mockFetchMetadata(validMetadata());
      failPostureWrite();

      const { status, json } = await redeemTestAuthorizationCode({
        clientId: cimdClientId,
        redirectUri: REDIRECT_URI,
        userId,
      });
      expect({ status, json }).toEqual({
        status: 400,
        json: {
          error: "invalid_client",
          error_description: "client is disabled",
        },
      });
      // What the provider stored is the document's own host.
      expect(await storedSector()).toBe("mcp-client.test");
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
