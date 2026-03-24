import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const JSON_RPC_ACCEPT = "application/json, text/event-stream";
const TRAILING_SLASHES = /\/+$/;

interface DpopKeyPair {
  jwk: JsonWebKey;
  privateKey: CryptoKey;
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
  resource?: string;
}

interface AuthorizationServerMetadata {
  token_endpoint?: string;
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

async function createDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });

  return {
    jwk: await exportJWK(publicKey),
    privateKey,
  };
}

function buildTokenProof(
  keyPair: DpopKeyPair,
  url: string,
  nonce?: string
): Promise<string> {
  return new SignJWT({
    htm: "POST",
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({
      alg: "ES256",
      jwk: keyPair.jwk,
      typ: "dpop+jwt",
    })
    .sign(keyPair.privateKey);
}

function buildResourceProof(
  keyPair: DpopKeyPair,
  method: string,
  url: string,
  accessToken: string
): Promise<string> {
  const ath = createHash("sha256").update(accessToken).digest("base64url");

  return new SignJWT({
    ath,
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  })
    .setProtectedHeader({
      alg: "ES256",
      jwk: keyPair.jwk,
      typ: "dpop+jwt",
    })
    .sign(keyPair.privateKey);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${text}`);
  }

  return JSON.parse(text) as T;
}

async function postTokenWithDpop(
  tokenEndpoint: string,
  body: Record<string, string>,
  keyPair: DpopKeyPair
): Promise<{ json: Record<string, unknown>; status: number }> {
  async function attempt(nonce?: string) {
    const proof = await buildTokenProof(keyPair, tokenEndpoint, nonce);
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: proof,
      },
      body: new URLSearchParams(body),
    });
    const text = await response.text();

    return {
      dpopNonce: response.headers.get("DPoP-Nonce") ?? undefined,
      json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
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

async function callMcp(
  mcpUrl: string,
  accessToken: string,
  keyPair: DpopKeyPair,
  body: Record<string, unknown>,
  sessionId?: string
): Promise<Response> {
  const proof = await buildResourceProof(keyPair, "POST", mcpUrl, accessToken);

  return fetch(mcpUrl, {
    method: "POST",
    headers: {
      Accept: JSON_RPC_ACCEPT,
      Authorization: `DPoP ${accessToken}`,
      "Content-Type": "application/json",
      DPoP: proof,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
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
        1,
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
          public,
          subject_type
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
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
  const keyPair = await createDpopKeyPair();

  try {
    await seedProbeState(clientId, authReqId, userId, mcpPublicUrl);

    const tokenResult = await postTokenWithDpop(
      authMetadata.token_endpoint,
      {
        auth_req_id: authReqId,
        client_id: clientId,
        grant_type: CIBA_GRANT_TYPE,
      },
      keyPair
    );

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

    const initializeResponse = await callMcp(
      mcpEndpoint,
      accessToken,
      keyPair,
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "live-mcp-probe", version: "0.1.0" },
          protocolVersion: "2025-03-26",
        },
      }
    );
    const initializeBody = await initializeResponse.text();
    const sessionId = initializeResponse.headers.get("mcp-session-id");

    console.log(
      JSON.stringify(
        {
          body: initializeBody,
          sessionId,
          stage: "initialize",
          status: initializeResponse.status,
        },
        null,
        2
      )
    );

    if (initializeResponse.status !== 200 || !sessionId) {
      throw new Error(
        `Initialize failed: ${initializeResponse.status} ${initializeBody}`
      );
    }

    const whoamiResponse = await callMcp(
      mcpEndpoint,
      accessToken,
      keyPair,
      {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {},
          name: "whoami",
        },
      },
      sessionId
    );
    const whoamiBody = await whoamiResponse.text();
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
      whoamiResponse.status !== 403 ||
      !wwwAuthenticate?.includes('scope="openid email"')
    ) {
      throw new Error(
        `Expected scoped challenge from whoami, got ${whoamiResponse.status} ${whoamiBody}`
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
