import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/auth";
import {
  callAuthApi,
  enrichDiscoveryMetadata,
  unwrapMetadata,
} from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test/db-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const MCP_PORT = 3300;
const MCP_PUBLIC_URL = `http://localhost:${MCP_PORT}`;
const REMOTE_CLIENT_ID = "mcp-http-test-client";
const TRAILING_SLASHES = /\/+$/;

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_POLL_TIMEOUT_MS = 15_000;

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

function startMcpSubprocess(authBaseUrl: string): ChildProcess {
  const tsxBin = resolve(
    import.meta.dirname,
    "../../../../node_modules/.bin/tsx"
  );
  const mcpEntry = resolve(
    import.meta.dirname,
    "../../../../../mcp/src/index.ts"
  );

  return spawn(
    tsxBin,
    [mcpEntry, "--transport", "http", "--port", String(MCP_PORT)],
    {
      env: {
        ...process.env,
        ZENTITY_URL: authBaseUrl,
        MCP_PUBLIC_URL,
        MCP_ALLOWED_ORIGINS: "*",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  const healthUrl = `${baseUrl}/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }

  throw new Error(
    `MCP subprocess did not become healthy within ${HEALTH_POLL_TIMEOUT_MS}ms`
  );
}

function killSubprocess(child: ChildProcess): void {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}

/**
 * Parse a JSON-RPC response from the MCP Streamable HTTP transport.
 * When Accept includes text/event-stream, the response may be SSE.
 */
function parseJsonRpcResponse(
  contentType: string | null,
  body: string
): unknown {
  if (contentType?.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      if (line.startsWith("data:")) {
        return JSON.parse(line.slice("data:".length).trim());
      }
    }
    throw new Error(`No data line found in SSE response: ${body}`);
  }
  return JSON.parse(body);
}

describe("remote MCP HTTP auth integration", () => {
  let authHarness: { baseUrl: string; server: Server } | undefined;
  let mcpProcess: ChildProcess | undefined;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    if (mcpProcess) {
      killSubprocess(mcpProcess);
      mcpProcess = undefined;
    }
    authHarness?.server.close();
    authHarness = undefined;
  });

  it("accepts initialize for the MCP resource and step-up challenges scoped tools", async () => {
    authHarness = await startAuthHarness();

    const userId = await createTestUser();

    await db
      .insert(oauthClients)
      .values({
        clientId: REMOTE_CLIENT_ID,
        grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
        name: "Remote MCP Test Client",
        public: true,
        redirectUris: JSON.stringify(["https://mcp-http.test/callback"]),
        subjectType: "pairwise",
        tokenEndpointAuthMethod: "none",
      })
      .run();

    const { authReqId } = await createTestCibaRequest({
      clientId: REMOTE_CLIENT_ID,
      userId,
      status: "approved",
      resource: MCP_PUBLIC_URL,
    });

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

    mcpProcess = startMcpSubprocess(authHarness.baseUrl);
    await waitForHealth(MCP_PUBLIC_URL);

    const mcpUrl = `${MCP_PUBLIC_URL}/mcp`;

    const initializeProof = await buildResourceDpopProof(
      resourceKeyPair,
      "POST",
      mcpUrl,
      accessToken
    );
    const initializeResponse = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `DPoP ${accessToken}`,
        "Content-Type": "application/json",
        DPoP: initializeProof,
      },
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
    });

    const initializeBody = await initializeResponse.text();
    if (initializeResponse.status !== 200) {
      throw new Error(
        `initialize failed: ${initializeResponse.status} ${initializeBody}`
      );
    }

    const initializeData = parseJsonRpcResponse(
      initializeResponse.headers.get("content-type"),
      initializeBody
    );
    expect(initializeData).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          protocolVersion: expect.any(String),
        }),
      })
    );

    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const whoamiProof = await buildResourceDpopProof(
      resourceKeyPair,
      "POST",
      mcpUrl,
      accessToken
    );
    const whoamiResponse = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `DPoP ${accessToken}`,
        "Content-Type": "application/json",
        DPoP: whoamiProof,
        "mcp-session-id": sessionId ?? "",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "whoami",
          arguments: {},
        },
      }),
    });

    const whoamiBody = await whoamiResponse.text();
    expect(whoamiResponse.status).toBe(200);
    expect(whoamiResponse.headers.get("WWW-Authenticate")).toBeNull();

    const whoamiData = parseJsonRpcResponse(
      whoamiResponse.headers.get("content-type"),
      whoamiBody
    ) as Record<string, unknown>;
    expect(whoamiData).toEqual(
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
