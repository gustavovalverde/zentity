import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createDpopNonce, DPOP_NONCE_HEADER } from "@better-auth/core/oauth2";
import {
  buildAuthHintsExtension,
  buildZentityExtension,
  createDpopClient,
  createPaymentRequired,
  type DpopClient,
  PROOF_OF_HUMAN_CHALLENGE,
} from "@zentity/sdk/rp";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DPoP proofs sign the URL the client calls (RFC 9449 §4.2), and Zentity
// checks them against its own endpoint URLs, so the harness must serve the
// issuer's origin. Reserve a port and point the app URL at it before the auth
// config loads.
const AUTH_HARNESS_PORT = await vi.hoisted(async () => {
  const { createServer } = await import("node:net");
  const port = await new Promise<number>((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address() as { port: number };
      probe.close(() => resolvePort(free));
    });
  });
  process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${port}`;
  return port;
});

import { auth } from "@/lib/auth/auth-config";
import { stageFinalCibaDisclosure } from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import {
  type McpClientCredentials,
  provisionMcpClient,
} from "@/lib/auth/oidc/mcp-client";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { seedTestAuthorizationCode } from "@/test-utils/authorization-code-test-utils";
import {
  confirmWithPasskey,
  postDecision,
  signInApprover,
} from "@/test-utils/ciba-decision-test-utils";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const MCP_PORT = 3300;
const MCP_PUBLIC_URL = `http://localhost:${MCP_PORT}`;
const REMOTE_CLIENT_ID = "mcp-http-test-client";
const TRAILING_SLASHES = /\/+$/;

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_POLL_TIMEOUT_MS = 15_000;
const USE_DPOP_NONCE_CHALLENGE = /^DPoP error="use_dpop_nonce"/;
const MCP_NONCE_CHALLENGE = {
  status: 401,
  challenge: expect.stringMatching(USE_DPOP_NONCE_CHALLENGE),
  hasNonce: true,
};
// A fixed secret lets the test mint an expired MCP nonce.
const MCP_DPOP_NONCE_SECRET = crypto.randomBytes(32).toString("base64url");
const MCP_PROTOCOL_VERSION = "2025-11-25";

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
    (await auth.api.getOpenIdConfig()) as Record<string, unknown>,
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

    // An x402 merchant on the issuer's host, for the MCP server to fetch.
    if (url.pathname === "/merchant/x402") {
      const issuer = discovery.issuer as string;
      return writeWebResponse(
        res,
        createPaymentRequired({
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "1",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x000000000000000000000000000000000000dEaD",
              maxTimeoutSeconds: 300,
              extra: { name: "USDC", version: "2" },
            },
          ],
          resource: { url: url.toString() },
          extensions: {
            "auth-hints": buildAuthHintsExtension({
              acceptIndexes: [0],
              authorizationServer: issuer,
              tokenEndpoint: `${issuer}/oauth2/token`,
            }),
            zentity: buildZentityExtension({
              minIdentityStrength: "documentary",
            }),
          },
          wwwAuthenticate: PROOF_OF_HUMAN_CHALLENGE,
        })
      );
    }

    if (url.pathname === "/api/auth/oauth2/jwks") {
      const { GET } = await import("@/app/api/auth/oauth2/jwks/route");
      return writeWebResponse(res, await GET());
    }

    if (url.pathname.startsWith("/api/trpc/")) {
      const body = await readRequestBody(req);
      const { GET, POST } = await import("@/app/api/trpc/[trpc]/route");
      const request = new Request(url.toString(), {
        headers: nodeHeadersToHeaders(req),
        method: req.method ?? "GET",
        ...(body && req.method !== "GET" ? { body: new Uint8Array(body) } : {}),
      });
      return writeWebResponse(
        res,
        await (req.method === "POST" ? POST : GET)(request)
      );
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

  server.listen(AUTH_HARNESS_PORT, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function postToken(
  dpop: DpopClient,
  tokenUrl: string,
  body: Record<string, string>
): Promise<{ json: Record<string, unknown>; status: number }> {
  const response = await dpop.fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  return {
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    status: response.status,
  };
}

function callMcp(
  dpop: DpopClient,
  accessToken: string,
  url: string,
  body: Record<string, unknown>,
  transport: typeof fetch = fetch
): Promise<Response> {
  return dpop.fetch(url, {
    accessToken,
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
    fetch: transport,
  });
}

/** Sends a tools/list call whose DPoP proof carries exactly `nonce`. */
async function callMcpWithNonce(
  dpop: DpopClient,
  accessToken: string,
  url: string,
  nonce: string
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `DPoP ${accessToken}`,
      "Content-Type": "application/json",
      DPoP: await dpop.proofFor("POST", url, accessToken, nonce),
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 9 }),
  });
}

/** The parts of a `use_dpop_nonce` challenge a client acts on. */
function nonceChallenge(response: Response) {
  return {
    status: response.status,
    challenge: response.headers.get("WWW-Authenticate"),
    hasNonce: Boolean(response.headers.get(DPOP_NONCE_HEADER)),
  };
}

function startMcpSubprocess(
  authBaseUrl: string,
  client: McpClientCredentials
): ChildProcess {
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
        HOME: mkdtempSync(join(tmpdir(), "zentity-mcp-http-")),
        ZENTITY_URL: authBaseUrl,
        MCP_PUBLIC_URL,
        MCP_ALLOWED_ORIGINS: "*",
        MCP_DPOP_NONCE_SECRET,
        MCP_CLIENT_ID: client.clientId,
        MCP_CLIENT_SECRET: client.clientSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

async function waitForHealth(baseUrl: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const res = await fetch(`${baseUrl}/health`);
      if (!res.ok) {
        throw new Error(`MCP health returned ${res.status}`);
      }
    },
    { timeout: HEALTH_POLL_TIMEOUT_MS, interval: HEALTH_POLL_INTERVAL_MS }
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

  afterEach(async () => {
    if (mcpProcess) {
      const exited =
        mcpProcess.exitCode === null ? once(mcpProcess, "exit") : undefined;
      killSubprocess(mcpProcess);
      // The next test's server listens on the same port.
      await exited;
      mcpProcess = undefined;
    }
    authHarness?.server.close();
    authHarness = undefined;
  });

  it("serves initialize and the read tools statelessly for an MCP-audienced token", async () => {
    authHarness = await startAuthHarness();

    const userId = await createTestUser({ email: "mcp-http@example.com" });
    // The confidential client MCP HTTP exchanges remote hosts' tokens as.
    const mcpClient = await provisionMcpClient({});

    const redirectUri = "https://mcp-http.test/callback";
    await db
      .insert(oauthClients)
      .values({
        clientId: REMOTE_CLIENT_ID,
        grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
        name: "Remote MCP Test Client",
        redirectUris: JSON.stringify([redirectUri]),
        responseTypes: JSON.stringify(["code"]),
        subjectType: "pairwise",
        tokenEndpointAuthMethod: "none",
      })
      .run();

    // A remote host signed the user in for the MCP server's resource.
    const { tokenRequest } = await seedTestAuthorizationCode({
      clientId: REMOTE_CLIENT_ID,
      redirectUri,
      userId,
      scope: "openid email compliance:read proof:identity",
      resource: MCP_PUBLIC_URL,
    });
    const dpop = await createDpopClient();
    const tokenResult = await postToken(
      dpop,
      `${authHarness.baseUrl}/api/auth/oauth2/token`,
      tokenRequest
    );

    expect(tokenResult.status).toBe(200);
    expect(tokenResult.json.token_type).toBe("DPoP");

    const accessToken = tokenResult.json.access_token as string;
    expect(typeof accessToken).toBe("string");

    mcpProcess = startMcpSubprocess(authHarness.baseUrl, mcpClient);
    const mcpOutput: Buffer[] = [];
    mcpProcess.stdout?.on("data", (chunk: Buffer) => mcpOutput.push(chunk));
    mcpProcess.stderr?.on("data", (chunk: Buffer) => mcpOutput.push(chunk));
    try {
      await waitForHealth(MCP_PUBLIC_URL);
    } catch (error) {
      const output = Buffer.concat(mcpOutput).toString("utf8").trim();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${output ? `\n${output}` : ""}`
      );
    }

    const mcpUrl = `${MCP_PUBLIC_URL}/mcp`;
    const exchanges: Response[] = [];
    const recordingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      exchanges.push(response.clone());
      return response;
    };

    const initializeResponse = await callMcp(
      dpop,
      accessToken,
      mcpUrl,
      {
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "integration-test", version: "0.1.0" },
        },
      },
      recordingFetch
    );

    const initializeBody = await initializeResponse.text();
    if (initializeResponse.status !== 200) {
      throw new Error(
        `initialize failed: ${initializeResponse.status} ${initializeBody}`
      );
    }
    // The MCP server is its own origin, so the first proof carries no nonce
    // and is challenged; the client retries with the nonce it was given.
    expect(exchanges).toHaveLength(2);
    expect(nonceChallenge(exchanges[0] as Response)).toEqual(
      MCP_NONCE_CHALLENGE
    );
    expect(initializeResponse.headers.get(DPOP_NONCE_HEADER)).toBeTruthy();
    expect(initializeResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(
      initializeResponse.headers.get("Access-Control-Expose-Headers")
    ).toContain("DPoP-Nonce");

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

    const whoamiResponse = await callMcp(
      dpop,
      accessToken,
      mcpUrl,
      {
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "whoami",
          arguments: {},
        },
      },
      recordingFetch
    );
    // The nonce from initialize is accepted on the first try.
    expect(exchanges).toHaveLength(3);

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
          // The exchanged token keeps the remote host's email scope.
          structuredContent: expect.objectContaining({
            email: "mcp-http@example.com",
            profileToolHint: "my_profile",
            tier: 0,
            vaultFieldsAvailable: ["name", "address", "birthdate"],
          }),
        }),
      })
    );

    // R28: the proof and compliance tools read Zentity with the token the
    // MCP server exchanged as its confidential client.
    for (const [id, name, expected] of [
      [3, "my_proofs", { verified: false, checks: expect.any(Array) }],
      [4, "check_compliance", { attested: false, networks: expect.any(Array) }],
    ] as const) {
      const toolResponse = await callMcp(dpop, accessToken, mcpUrl, {
        jsonrpc: "2.0",
        method: "tools/call",
        id,
        params: { name, arguments: {} },
      });
      const toolData = parseJsonRpcResponse(
        toolResponse.headers.get("content-type"),
        await toolResponse.text()
      ) as { result?: { isError?: boolean; structuredContent?: unknown } };
      expect({ name, isError: toolData.result?.isError ?? false }).toEqual({
        name,
        isError: false,
      });
      expect(toolData.result?.structuredContent).toEqual(
        expect.objectContaining(expected)
      );
    }

    // Nonces from Zentity's origin, from another secret, or past their
    // lifetime are refused with a fresh one.
    const zentityNonce = await createDpopNonce({
      secret: (await auth.$context).secret,
    });
    const foreignNonce = await createDpopNonce({
      secret: crypto.randomBytes(32).toString("base64url"),
    });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now - 600_000);
    const staleNonce = await createDpopNonce({
      secret: MCP_DPOP_NONCE_SECRET,
    });
    clock.mockRestore();
    for (const nonce of [zentityNonce, foreignNonce, staleNonce]) {
      expect(
        nonceChallenge(await callMcpWithNonce(dpop, accessToken, mcpUrl, nonce))
      ).toEqual(MCP_NONCE_CHALLENGE);
    }
  });

  // The purchase tool on the HTTP transport, as its confidential client: a
  // passkey-approved purchase releases the shipping name once, and an x402
  // purchase answers payment_not_configured because the server has no
  // payment scheme client.
  it("runs the purchase tool as the confidential client", async () => {
    authHarness = await startAuthHarness();
    const userId = await createTestUser({ email: "mcp-buyer@example.com" });
    const authenticator = await new TestAuthenticator().register(userId);
    const mcpClient = await provisionMcpClient({});
    const redirectUri = "https://mcp-http.test/callback";
    await db
      .insert(oauthClients)
      .values({
        clientId: REMOTE_CLIENT_ID,
        grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
        name: "Remote MCP Test Client",
        redirectUris: JSON.stringify([redirectUri]),
        responseTypes: JSON.stringify(["code"]),
        subjectType: "pairwise",
        tokenEndpointAuthMethod: "none",
      })
      .run();
    const { tokenRequest } = await seedTestAuthorizationCode({
      clientId: REMOTE_CLIENT_ID,
      redirectUri,
      userId,
      scope: "openid email",
      resource: MCP_PUBLIC_URL,
    });
    const dpop = await createDpopClient();
    const tokenResult = await postToken(
      dpop,
      `${authHarness.baseUrl}/api/auth/oauth2/token`,
      tokenRequest
    );
    const accessToken = tokenResult.json.access_token as string;

    mcpProcess = startMcpSubprocess(authHarness.baseUrl, mcpClient);
    await waitForHealth(MCP_PUBLIC_URL);
    const mcpUrl = `${MCP_PUBLIC_URL}/mcp`;
    let id = 10;
    async function callTool(name: string, args: Record<string, unknown>) {
      id += 1;
      const response = await callMcp(dpop, accessToken, mcpUrl, {
        jsonrpc: "2.0",
        method: "tools/call",
        id,
        params: { name, arguments: args },
      });
      const data = parseJsonRpcResponse(
        response.headers.get("content-type"),
        await response.text()
      ) as { result?: { structuredContent?: Record<string, unknown> } };
      return data.result?.structuredContent ?? {};
    }

    const purchase = {
      merchant: "Corner Books",
      item: "A paperback",
      amount: 12,
      currency: "EUR",
    };
    const pending = await callTool("purchase", purchase);
    expect(pending.status).toBe("needs_user_action");

    const request = await db
      .select()
      .from(cibaRequests)
      .where(eq(cibaRequests.clientId, mcpClient.clientId))
      .get();
    expect(request?.bindingMessage).toBe("Buy from Corner Books");
    expect(request?.scope).toBe("openid identity.name identity.address");
    expect(JSON.parse(request?.authorizationDetails as string)).toEqual([
      {
        type: "purchase",
        merchant: { name: "Corner Books" },
        item: "A paperback",
        amount: { value: "12.00", currency: "EUR" },
      },
    ]);

    const identityScopes = ["identity.name", "identity.address"];
    await stageFinalCibaDisclosure({
      userId,
      clientId: mcpClient.clientId,
      claims: {
        given_name: "Ada",
        family_name: "Lovelace",
        name: "Ada Lovelace",
      },
      authReqId: request?.authReqId as string,
      scopes: identityScopes,
      scopeHash: createScopeHash(identityScopes),
      intentJti: crypto.randomUUID(),
    });
    const approver = await signInApprover(userId);
    const decision = await postDecision(approver, {
      request_id: request?.id as string,
      channel: "page",
      // The harness serves the issuer on 127.0.0.1, the passkey RP ID here.
      webauthn: await confirmWithPasskey(
        approver,
        request?.id as string,
        authenticator,
        { origin: authHarness.baseUrl, rpId: "127.0.0.1" }
      ),
    });
    expect(decision).toEqual(expect.objectContaining({ status: 200 }));

    const approved = await vi.waitFor(
      async () => {
        const result = await callTool("purchase", purchase);
        if (result.status !== "approved") {
          throw new Error(`purchase is ${String(result.status)}`);
        }
        return result;
      },
      { timeout: 20_000, interval: 1000 }
    );
    expect(approved).toEqual(
      expect.objectContaining({
        approved: true,
        fulfillment: expect.objectContaining({ name: "Ada Lovelace" }),
      })
    );

    const x402 = await callTool("purchase", {
      url: `${authHarness.baseUrl}/merchant/x402`,
      maxAmount: 1,
    });
    expect(x402.status).toBe("payment_not_configured");
  });
});
