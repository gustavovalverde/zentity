import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { createDpopClient, type DpopClient } from "@zentity/sdk/rp";
import { makeSignature } from "better-auth/crypto";

const PROBE_REDIRECT_URI = "https://example.com/callback";
const PROBE_SCOPE = "openid proof:identity identity.name";
const JSON_RPC_ACCEPT = "application/json, text/event-stream";
const TRAILING_SLASHES = /\/+$/;

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
  resource?: string;
}

interface AuthorizationServerMetadata {
  token_endpoint?: string;
}

interface JsonRpcToolResponse {
  result?: {
    structuredContent?: Record<string, unknown>;
  };
}

function normalizeUrl(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

function createDatabaseClient() {
  const authToken = process.env.TURSO_AUTH_TOKEN;

  return createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:./.data/dev.db",
    ...(authToken ? { authToken } : {}),
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${text}`);
  }

  return JSON.parse(text) as T;
}

/** Sends a token request; the SDK client answers a nonce challenge. */
async function postToken(
  dpop: DpopClient,
  tokenEndpoint: string,
  body: Record<string, string>
): Promise<{ json: Record<string, unknown>; status: number }> {
  const response = await dpop.fetch(tokenEndpoint, {
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

const MCP_PROTOCOL_VERSION = "2025-11-25";

function callMcp(
  mcpUrl: string,
  accessToken: string,
  dpop: DpopClient,
  body: Record<string, unknown>
): Promise<Response> {
  return dpop.fetch(mcpUrl, {
    accessToken,
    method: "POST",
    headers: {
      Accept: JSON_RPC_ACCEPT,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
  });
}

function getAuthorizationServerMetadataUrl(authServer: string): string {
  return new URL(
    ".well-known/oauth-authorization-server",
    `${normalizeUrl(authServer)}/`
  ).toString();
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

interface ProbeState {
  authContextId: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  sessionId: string;
  sessionToken: string;
  userId: string;
}

/**
 * Seeds a remote host that signed a user in for the MCP resource: a public
 * client, a session, and an authorization code to redeem for the host's
 * MCP-audience token. The MCP server exchanges that token as its own
 * confidential client (`MCP_CLIENT_ID`).
 */
async function seedProbeState(
  state: ProbeState,
  mcpPublicUrl: string
): Promise<void> {
  const database = createDatabaseClient();
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const query = {
    client_id: state.clientId,
    code_challenge: sha256Base64Url(state.codeVerifier),
    code_challenge_method: "S256",
    redirect_uri: PROBE_REDIRECT_URI,
    resource: mcpPublicUrl,
    response_type: "code",
    scope: PROBE_SCOPE,
  };

  await database.batch([
    {
      args: [
        state.userId,
        `probe-${state.userId}@example.com`,
        1,
        timestamp,
        timestamp,
      ],
      sql: `
        insert into user (id, email, emailVerified, createdAt, updatedAt)
        values (?, ?, ?, ?, ?)
      `,
    },
    {
      args: [
        state.authContextId,
        state.userId,
        "better_auth",
        "passkey",
        JSON.stringify(["pop", "user"]),
        "strong",
        now,
        now,
      ],
      sql: `
        insert into authentication_context (
          id, user_id, source_kind, login_method, amr, auth_strength,
          authenticated_at, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    },
    {
      args: [
        state.sessionId,
        state.sessionToken,
        state.userId,
        state.authContextId,
        now + 3_600_000,
        now,
        now,
      ],
      sql: `
        insert into session (
          id, token, userId, authContextId, expiresAt, createdAt, updatedAt
        ) values (?, ?, ?, ?, ?, ?, ?)
      `,
    },
    {
      args: [
        randomUUID(),
        state.clientId,
        "Live MCP Probe",
        JSON.stringify([PROBE_REDIRECT_URI]),
        JSON.stringify(["authorization_code"]),
        JSON.stringify(["code"]),
        "none",
        "pairwise",
      ],
      sql: `
        insert into oauth_client (
          id,
          client_id,
          name,
          redirect_uris,
          grant_types,
          response_types,
          token_endpoint_auth_method,
          subject_type
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    },
    {
      args: [
        randomUUID(),
        sha256Base64Url(state.code),
        JSON.stringify({
          authContextId: state.authContextId,
          authTime: now,
          query,
          referenceId: randomUUID(),
          sessionId: state.sessionId,
          type: "authorization_code",
          userId: state.userId,
        }),
        now + 300_000,
        now,
        now,
      ],
      sql: `
        insert into verification (
          id, identifier, value, expiresAt, createdAt, updatedAt
        ) values (?, ?, ?, ?, ?, ?)
      `,
    },
  ]);
}

const PROBE_NAME = {
  family_name: "Lovelace",
  given_name: "Ada",
  name: "Ada Lovelace",
};

/** The browser cookie for the seeded session, signed as Better Auth signs it. */
async function sessionCookie(state: ProbeState): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to approve as the user");
  }
  const signature = await makeSignature(state.sessionToken, secret);
  return `better-auth.session_token=${encodeURIComponent(`${state.sessionToken}.${signature}`)}`;
}

async function postAsUser(
  url: string,
  cookie: string,
  origin: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(
    JSON.stringify(
      { stage: new URL(url).pathname, status: response.status },
      null,
      2
    )
  );
  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status} ${text}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/**
 * Does what the approval page does for a user without a passkey: stages the
 * released name for the request, then approves it with the session.
 */
async function approveAsUser(
  state: ProbeState,
  authServer: string,
  interactionUrl: string
): Promise<void> {
  const authReqId = new URL(interactionUrl).searchParams.get("authReqId");
  if (!authReqId) {
    throw new Error(`No authReqId in the approval URL: ${interactionUrl}`);
  }
  const database = createDatabaseClient();
  const { rows } = await database.execute({
    args: [sha256Base64Url(authReqId)],
    sql: "select id, scope from ciba_request where auth_req_id = ?",
  });
  const requestId = rows[0]?.id;
  const scope = rows[0]?.scope;
  if (typeof requestId !== "string" || typeof scope !== "string") {
    throw new Error("The MCP server's CIBA request was not stored");
  }
  const scopes = scope
    .split(" ")
    .filter((value) => value.startsWith("identity."));

  const origin = new URL(authServer).origin;
  const cookie = await sessionCookie(state);
  const { intent_token: intentToken } = await postAsUser(
    `${origin}/api/ciba/identity/intent`,
    cookie,
    origin,
    { request_id: requestId, scopes }
  );
  await postAsUser(`${origin}/api/ciba/identity/stage`, cookie, origin, {
    identity: PROBE_NAME,
    intent_token: intentToken,
    request_id: requestId,
    scopes,
  });
  await postAsUser(
    `${normalizeUrl(authServer)}/ciba/decision`,
    cookie,
    origin,
    {
      channel: "page",
      decision: "approved",
      request_id: requestId,
    }
  );
}

async function cleanupProbeState(state: ProbeState): Promise<void> {
  const database = createDatabaseClient();

  await database.batch([
    {
      args: [sha256Base64Url(state.code)],
      sql: "delete from verification where identifier = ?",
    },
    {
      args: [state.userId],
      sql: "delete from ciba_approval where user_id = ?",
    },
    {
      args: [state.userId],
      sql: "delete from ciba_request where user_id = ?",
    },
    {
      args: [state.userId],
      sql: "delete from oauth_access_token where user_id = ?",
    },
    {
      args: [state.userId],
      sql: "delete from oauth_refresh_token where user_id = ?",
    },
    {
      args: [state.clientId],
      sql: "delete from oauth_client where client_id = ?",
    },
    {
      args: [state.sessionId],
      sql: "delete from session where id = ?",
    },
    {
      args: [state.userId],
      sql: "delete from authentication_context where user_id = ?",
    },
    {
      args: [state.userId],
      sql: "delete from user where id = ?",
    },
  ]);
}

/** A Streamable HTTP response is JSON, or SSE whose data line holds it. */
function parseJsonRpc(contentType: string | null, body: string): unknown {
  if (contentType?.includes("text/event-stream")) {
    const data = body
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.slice("data:".length);
    if (!data) {
      throw new Error(`No data line in the SSE response: ${body}`);
    }
    return JSON.parse(data);
  }
  return JSON.parse(body);
}

async function callTool(
  mcpEndpoint: string,
  accessToken: string,
  dpop: DpopClient,
  id: number,
  name: string,
  args: Record<string, unknown> = {}
) {
  const response = await callMcp(mcpEndpoint, accessToken, dpop, {
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: args, name },
  });
  const body = await response.text();
  console.log(
    JSON.stringify(
      {
        body,
        stage: name,
        status: response.status,
        wwwAuthenticate: response.headers.get("www-authenticate"),
      },
      null,
      2
    )
  );
  return {
    json: parseJsonRpc(
      response.headers.get("content-type"),
      body
    ) as JsonRpcToolResponse,
    response,
  };
}

async function main(): Promise<void> {
  const mcpPublicUrl = normalizeUrl(
    process.env.MCP_PUBLIC_URL ?? "http://localhost:3300"
  );
  const mcpEndpoint = `${mcpPublicUrl}/mcp`;

  const protectedResource = await getJson<ProtectedResourceMetadata>(
    `${mcpPublicUrl}/.well-known/oauth-protected-resource`
  );

  const authServer = protectedResource.authorization_servers?.[0];
  if (!authServer) {
    throw new Error("MCP metadata did not advertise an authorization server");
  }

  const advertisedResource = normalizeUrl(protectedResource.resource ?? "");
  if (advertisedResource !== mcpPublicUrl) {
    throw new Error(
      `MCP metadata resource mismatch: expected ${mcpPublicUrl}, got ${advertisedResource}`
    );
  }

  const authMetadata = await getJson<AuthorizationServerMetadata>(
    getAuthorizationServerMetadataUrl(authServer)
  );
  if (!authMetadata.token_endpoint) {
    throw new Error("Authorization server metadata missing token_endpoint");
  }

  const state: ProbeState = {
    authContextId: randomUUID(),
    clientId: `live-mcp-probe-${randomUUID()}`,
    code: randomUUID(),
    codeVerifier: `${randomUUID()}${randomUUID()}`,
    sessionId: randomUUID(),
    sessionToken: randomUUID(),
    userId: randomUUID(),
  };
  const dpop = await createDpopClient();

  try {
    await seedProbeState(state, mcpPublicUrl);

    const tokenResult = await postToken(dpop, authMetadata.token_endpoint, {
      client_id: state.clientId,
      code: state.code,
      code_verifier: state.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: PROBE_REDIRECT_URI,
      resource: mcpPublicUrl,
    });

    console.log(
      JSON.stringify(
        {
          stage: "token",
          status: tokenResult.status,
          tokenType: tokenResult.json.token_type,
        },
        null,
        2
      )
    );

    if (
      tokenResult.status !== 200 ||
      typeof tokenResult.json.access_token !== "string"
    ) {
      throw new Error(
        `Token request failed: ${JSON.stringify(tokenResult.json, null, 2)}`
      );
    }

    const accessToken = tokenResult.json.access_token;

    const initializeResponse = await callMcp(mcpEndpoint, accessToken, dpop, {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "live-mcp-probe", version: "0.1.0" },
        protocolVersion: MCP_PROTOCOL_VERSION,
      },
    });
    const initializeBody = await initializeResponse.text();

    console.log(
      JSON.stringify(
        {
          body: initializeBody,
          stage: "initialize",
          status: initializeResponse.status,
        },
        null,
        2
      )
    );

    if (initializeResponse.status !== 200) {
      throw new Error(
        `Initialize failed: ${initializeResponse.status} ${initializeBody}`
      );
    }

    const whoami = await callTool(mcpEndpoint, accessToken, dpop, 2, "whoami");
    if (
      whoami.response.status !== 200 ||
      whoami.json.result?.structuredContent?.email !== null ||
      whoami.response.headers.get("www-authenticate") !== null
    ) {
      throw new Error(
        "Expected whoami to succeed without email disclosure through the exchanged token"
      );
    }

    // my_profile asks the user through CIBA, which the MCP server starts as
    // its confidential client; the tool answers with the approval URL.
    const profile = await callTool(
      mcpEndpoint,
      accessToken,
      dpop,
      3,
      "my_profile",
      { fields: ["name"] }
    );
    const interaction = profile.json.result?.structuredContent?.interaction as
      | { url?: string }
      | undefined;
    if (
      profile.json.result?.structuredContent?.status !== "needs_user_action" ||
      !interaction?.url
    ) {
      throw new Error(
        "Expected my_profile to start a CIBA approval for the MCP client"
      );
    }

    await approveAsUser(state, authServer, interaction.url);

    const released = await callTool(
      mcpEndpoint,
      accessToken,
      dpop,
      4,
      "my_profile",
      { fields: ["name"] }
    );
    const releasedContent = released.json.result?.structuredContent as
      | { profile?: { name?: { full?: string } }; status?: string }
      | undefined;
    if (
      releasedContent?.status !== "complete" ||
      releasedContent.profile?.name?.full !== PROBE_NAME.name
    ) {
      throw new Error(
        "Expected my_profile to return the name the user released"
      );
    }
  } finally {
    await cleanupProbeState(state);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
