import type { AddressInfo } from "node:net";

import crypto from "node:crypto";
import { once } from "node:events";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import {
  callAuthApi,
  enrichDiscoveryMetadata,
  unwrapMetadata,
} from "@/lib/auth/well-known-utils";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const MCP_PUBLIC_URL = "http://localhost:3200";
const MCP_SERVER_CLIENT_ID = "mcp-http-test-server";
const REMOTE_CLIENT_ID = "mcp-http-test-client";
const TRAILING_SLASHES = /\/+$/;

interface DpopKeyPair {
  jwk: JsonWebKey;
  privateKey: CryptoKey;
}

function nodeHeadersToHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readRequestBody(
  req: IncomingMessage
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return Buffer.concat(chunks);
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function rewriteDiscoveryMetadata(
  metadata: Record<string, unknown>,
  baseUrl: string
): Record<string, unknown> {
  const issuer = metadata.issuer as string;
  const issuerUrl = new URL(issuer);
  const authPath = issuerUrl.pathname.replace(TRAILING_SLASHES, "");

  return {
    ...metadata,
    authorization_endpoint: `${baseUrl}${authPath}/oauth2/authorize`,
    backchannel_authentication_endpoint: `${baseUrl}${authPath}/oauth2/bc-authorize`,
    end_session_endpoint: `${baseUrl}${authPath}/oauth2/end-session`,
    introspection_endpoint: `${baseUrl}${authPath}/oauth2/introspect`,
    jwks_uri: `${baseUrl}${authPath}/oauth2/jwks`,
    pushed_authorization_request_endpoint: `${baseUrl}${authPath}/oauth2/par`,
    registration_endpoint: `${baseUrl}${authPath}/oauth2/register`,
    revocation_endpoint: `${baseUrl}${authPath}/oauth2/revoke`,
    token_endpoint: `${baseUrl}${authPath}/oauth2/token`,
    userinfo_endpoint: `${baseUrl}${authPath}/oauth2/userinfo`,
  };
}

async function startAuthHarness(): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const discovery = rewriteDiscoveryMetadata(
    enrichDiscoveryMetadata(
      unwrapMetadata(await callAuthApi(auth.api, "getOpenIdConfig")) as Record<
        string,
        unknown
      >
    ),
    "http://127.0.0.1"
  );

  const server = createHttpServer(async (req, res) => {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const url = new URL(req.url ?? "/", baseUrl);

    if (url.pathname === "/.well-known/openid-configuration") {
      return writeWebResponse(
        res,
        new Response(
          JSON.stringify(rewriteDiscoveryMetadata(discovery, baseUrl)),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      );
    }

    if (url.pathname === "/api/auth/oauth2/jwks") {
      const { GET } = await import("@/app/api/auth/oauth2/jwks/route");
      return writeWebResponse(res, await GET());
    }

    if (url.pathname.startsWith("/api/auth/")) {
      const body = await readRequestBody(req);
      const requestInit: RequestInit = {
        headers: nodeHeadersToHeaders(req),
      };
      if (req.method) {
        requestInit.method = req.method;
      }
      if (body && req.method !== "GET" && req.method !== "HEAD") {
        requestInit.body = new Uint8Array(body);
      }
      const request = new Request(url.toString(), requestInit);
      return writeWebResponse(res, await auth.handler(request));
    }

    return writeWebResponse(
      res,
      new Response("Not Found", {
        status: 404,
      })
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function createDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  return {
    jwk: await exportJWK(publicKey),
    privateKey,
  };
}

function buildTokenDpopProof(
  keyPair: DpopKeyPair,
  url: string,
  nonce?: string
): Promise<string> {
  return new SignJWT({
    htm: "POST",
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({
      alg: "ES256",
      jwk: keyPair.jwk,
      typ: "dpop+jwt",
    })
    .sign(keyPair.privateKey);
}

function buildResourceDpopProof(
  keyPair: DpopKeyPair,
  method: string,
  url: string,
  accessToken: string
): Promise<string> {
  const ath = crypto
    .createHash("sha256")
    .update(accessToken)
    .digest("base64url");

  return new SignJWT({
    ath,
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({
      alg: "ES256",
      jwk: keyPair.jwk,
      typ: "dpop+jwt",
    })
    .sign(keyPair.privateKey);
}

async function postTokenWithDpop(
  tokenUrl: string,
  body: Record<string, string>,
  keyPair: DpopKeyPair
): Promise<{ json: Record<string, unknown>; status: number }> {
  async function attempt(nonce?: string) {
    const proof = await buildTokenDpopProof(keyPair, tokenUrl, nonce);
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: proof,
      },
      body: new URLSearchParams(body),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const json =
      payload && typeof payload === "object" && "response" in payload
        ? ((payload.response as Record<string, unknown>) ?? {})
        : payload;

    return {
      dpopNonce: response.headers.get("DPoP-Nonce"),
      json,
      status: response.status,
    };
  }

  const first = await attempt();
  if ((first.status === 400 || first.status === 401) && first.dpopNonce) {
    const retry = await attempt(first.dpopNonce);
    return { json: retry.json, status: retry.status };
  }

  return { json: first.json, status: first.status };
}

describe("remote MCP HTTP auth integration", () => {
  let authHarness: { baseUrl: string; server: Server } | undefined;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    authHarness?.server.close();
    authHarness = undefined;
    process.env.ZENTITY_URL = undefined;
    process.env.MCP_PUBLIC_URL = undefined;
    vi.resetModules();
  });

  it("accepts initialize for the MCP resource and step-up challenges scoped tools", async () => {
    authHarness = await startAuthHarness();

    const userId = await createTestUser();
    const authReqId = crypto.randomUUID();

    await db
      .insert(oauthClients)
      .values([
        {
          clientId: REMOTE_CLIENT_ID,
          grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
          name: "Remote MCP Test Client",
          public: true,
          redirectUris: JSON.stringify(["https://mcp-http.test/callback"]),
          subjectType: "pairwise",
          tokenEndpointAuthMethod: "none",
        },
        {
          clientId: MCP_SERVER_CLIENT_ID,
          grantTypes: JSON.stringify([TOKEN_EXCHANGE_GRANT_TYPE]),
          name: "MCP HTTP Test Server",
          public: true,
          redirectUris: JSON.stringify(["http://127.0.0.1/callback"]),
          tokenEndpointAuthMethod: "none",
        },
      ])
      .run();

    await db
      .insert(cibaRequests)
      .values({
        authReqId,
        clientId: REMOTE_CLIENT_ID,
        userId,
        scope: "openid",
        status: "approved",
        resource: MCP_PUBLIC_URL,
        expiresAt: new Date(Date.now() + 300_000),
      })
      .run();

    const resourceKeyPair = await createDpopKeyPair();
    const tokenResult = await postTokenWithDpop(
      `${authHarness.baseUrl}/api/auth/oauth2/token`,
      {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: REMOTE_CLIENT_ID,
      },
      resourceKeyPair
    );

    expect(tokenResult.status).toBe(200);
    expect(tokenResult.json.token_type).toBe("DPoP");

    const accessToken = tokenResult.json.access_token as string;
    expect(typeof accessToken).toBe("string");

    const jwksResponse = await fetch(
      `${authHarness.baseUrl}/api/auth/oauth2/jwks`
    );
    const jwksBody = await jwksResponse.text();
    if (jwksResponse.status !== 200) {
      throw new Error(`jwks failed: ${jwksResponse.status} ${jwksBody}`);
    }

    process.env.ZENTITY_URL = authHarness.baseUrl;
    process.env.MCP_PUBLIC_URL = MCP_PUBLIC_URL;
    vi.resetModules();

    const { createApp, setServerCredentials } = await import(
      "../../../../../mcp/src/transports/http"
    );
    const { clearDiscoveryCache, discover } = await import(
      "../../../../../mcp/src/auth/discovery"
    );
    const { resetJwks } = await import(
      "../../../../../mcp/src/auth/token-auth"
    );

    clearDiscoveryCache();
    resetJwks();
    await discover(authHarness.baseUrl);

    const serverKeyPair = await createDpopKeyPair();
    setServerCredentials({
      clientId: MCP_SERVER_CLIENT_ID,
      dpopKey: {
        privateJwk: await exportJWK(serverKeyPair.privateKey),
        publicJwk: serverKeyPair.jwk,
      },
    });

    const app = createApp();

    const initializeProof = await buildResourceDpopProof(
      resourceKeyPair,
      "POST",
      `${MCP_PUBLIC_URL}/mcp`,
      accessToken
    );
    const initializeResponse = await app.request(`${MCP_PUBLIC_URL}/mcp`, {
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "integration-test", version: "0.1.0" },
        },
      }),
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `DPoP ${accessToken}`,
        "Content-Type": "application/json",
        DPoP: initializeProof,
      },
      method: "POST",
    });

    const initializeBody = await initializeResponse.text();
    if (initializeResponse.status !== 200) {
      throw new Error(
        `initialize failed: ${initializeResponse.status} ${initializeBody}`
      );
    }
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const whoamiProof = await buildResourceDpopProof(
      resourceKeyPair,
      "POST",
      `${MCP_PUBLIC_URL}/mcp`,
      accessToken
    );
    const whoamiResponse = await app.request(`${MCP_PUBLIC_URL}/mcp`, {
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "whoami",
          arguments: {},
        },
      }),
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `DPoP ${accessToken}`,
        "Content-Type": "application/json",
        DPoP: whoamiProof,
        "mcp-session-id": sessionId ?? "",
      },
      method: "POST",
    });

    expect(whoamiResponse.status).toBe(200);
    expect(whoamiResponse.headers.get("WWW-Authenticate")).toBeNull();
    await expect(whoamiResponse.json()).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({
            email: null,
            profileToolHint: "my_profile",
            vaultFieldsAvailable: ["name", "address", "birthdate"],
          }),
        }),
      })
    );
  });
});
