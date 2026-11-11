import { randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { createDpopClient, type DpopClient } from "@zentity/sdk/rp";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
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

async function seedProbeState(
  clientId: string,
  authReqId: string,
  userId: string,
  mcpPublicUrl: string
): Promise<void> {
  const database = createDatabaseClient();
  const timestamp = new Date().toISOString();

  await database.batch([
    {
      args: [userId, `probe-${userId}@example.com`, 1, timestamp, timestamp],
      sql: `
        insert into user (id, email, emailVerified, createdAt, updatedAt)
        values (?, ?, ?, ?, ?)
      `,
    },
    {
      args: [
        randomUUID(),
        clientId,
        "Live MCP Probe",
        JSON.stringify(["https://example.com/callback"]),
        JSON.stringify([CIBA_GRANT_TYPE]),
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
          token_endpoint_auth_method,
          subject_type
        ) values (?, ?, ?, ?, ?, ?, ?)
      `,
    },
    {
      args: [
        randomUUID(),
        authReqId,
        clientId,
        userId,
        "openid",
        mcpPublicUrl,
        "approved",
        "poll",
        5,
        Date.now() + 300_000,
      ],
      sql: `
        insert into ciba_request (
          id,
          auth_req_id,
          client_id,
          user_id,
          scope,
          resource,
          status,
          delivery_mode,
          polling_interval,
          expires_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    },
  ]);
}

async function cleanupProbeState(
  clientId: string,
  authReqId: string,
  userId: string
): Promise<void> {
  const database = createDatabaseClient();

  await database.batch([
    {
      args: [authReqId],
      sql: "delete from ciba_request where auth_req_id = ?",
    },
    {
      args: [clientId],
      sql: "delete from oauth_client where client_id = ?",
    },
    {
      args: [userId],
      sql: "delete from user where id = ?",
    },
  ]);
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

  const clientId = `live-mcp-probe-${randomUUID()}`;
  const authReqId = randomUUID();
  const userId = randomUUID();
  const dpop = await createDpopClient();

  try {
    await seedProbeState(clientId, authReqId, userId, mcpPublicUrl);

    const tokenResult = await postToken(dpop, authMetadata.token_endpoint, {
      auth_req_id: authReqId,
      client_id: clientId,
      grant_type: CIBA_GRANT_TYPE,
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
        `Token exchange failed: ${JSON.stringify(tokenResult.json, null, 2)}`
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

    const whoamiResponse = await callMcp(mcpEndpoint, accessToken, dpop, {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {},
        name: "whoami",
      },
    });
    const whoamiBody = await whoamiResponse.text();
    const whoamiJson = JSON.parse(whoamiBody) as JsonRpcToolResponse;
    const wwwAuthenticate = whoamiResponse.headers.get("www-authenticate");

    console.log(
      JSON.stringify(
        {
          body: whoamiBody,
          stage: "whoami",
          status: whoamiResponse.status,
          wwwAuthenticate,
        },
        null,
        2
      )
    );

    if (
      whoamiResponse.status !== 200 ||
      whoamiJson.result?.structuredContent?.email !== null ||
      wwwAuthenticate !== null
    ) {
      throw new Error(
        `Expected whoami to succeed without email disclosure, got ${whoamiResponse.status} ${whoamiBody}`
      );
    }
  } finally {
    await cleanupProbeState(clientId, authReqId, userId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
