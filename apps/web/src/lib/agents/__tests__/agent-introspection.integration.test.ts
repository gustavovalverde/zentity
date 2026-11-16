import crypto from "node:crypto";

import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { pairwiseValue } from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import {
  oauthClientResources,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const AGENT_CLIENT_ID = "ciba-test-agent";
const AGENT_CLIENT_SECRET = "agent-client-secret";
const INTROSPECTOR_CLIENT_ID = "agent-introspector";
const INTROSPECTOR_SECRET = "introspector-secret";
const RP_API_AUDIENCE = `${getAuthIssuer()}/resource/rp-api`;
const AGENT_SECTOR = "agent-client.example.com";

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("base64url");
}

async function createAgentClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: AGENT_CLIENT_ID,
      name: AGENT_CLIENT_ID,
      clientSecret: hashSecret(AGENT_CLIENT_SECRET),
      redirectUris: JSON.stringify([`https://${AGENT_SECTOR}/callback`]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE, "client_credentials"]),
      clientCredentialsScopes: JSON.stringify(["agent:introspect"]),
      scopes: JSON.stringify(["openid", "agent:introspect"]),
      tokenEndpointAuthMethod: "client_secret_post",
      subjectType: "pairwise",
      metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
    })
    .run();
}

async function createIntrospectorClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: INTROSPECTOR_CLIENT_ID,
      name: INTROSPECTOR_CLIENT_ID,
      clientSecret: hashSecret(INTROSPECTOR_SECRET),
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["client_credentials"]),
      clientCredentialsScopes: JSON.stringify(["agent:introspect"]),
      scopes: JSON.stringify(["agent:introspect"]),
      tokenEndpointAuthMethod: "client_secret_post",
    })
    .run();
}

async function createRegisteredAgent(
  userId: string,
  sessionOverrides?: Partial<{
    createdAt: Date;
    idleTtlSec: number;
    lastActiveAt: Date;
    maxLifetimeSec: number;
    status: "active" | "expired" | "revoked";
  }>
) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: AGENT_CLIENT_ID,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
      publicKeyThumbprint: `host-thumbprint-${crypto.randomUUID()}`,
      name: "Test Host",
      attestationProvider: "AgentPass",
      attestationTier: "attested",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected registered host fixture to be created");
  }

  const [session] = await db
    .insert(agentSessions)
    .values({
      createdAt: sessionOverrides?.createdAt,
      hostId: host.id,
      idleTtlSec: sessionOverrides?.idleTtlSec,
      lastActiveAt: sessionOverrides?.lastActiveAt,
      maxLifetimeSec: sessionOverrides?.maxLifetimeSec,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
      publicKeyThumbprint: `agent-thumbprint-${crypto.randomUUID()}`,
      displayName: "Test Agent",
      runtime: "test-runner",
      model: "gpt-4",
      status: sessionOverrides?.status,
      version: "1.0.0",
    })
    .returning({ id: agentSessions.id });

  if (!session) {
    throw new Error("Expected registered session fixture to be created");
  }

  return { hostId: host.id, sessionId: session.id };
}

/** An agent token for the MCP server (a JWT), or for Zentity (opaque). */
async function issueAgentToken(
  userId: string,
  agent: { hostId: string; sessionId: string },
  audience: "mcp" | "zentity"
) {
  const { authReqId } = await createTestCibaRequest({
    clientId: AGENT_CLIENT_ID,
    userId,
    scope: "openid",
    status: "approved",
    ...(audience === "mcp"
      ? { resources: JSON.stringify([env.MCP_PUBLIC_URL]) }
      : {}),
    hostId: agent.hostId,
    agentSessionId: agent.sessionId,
    displayName: "Test Agent",
    taskId: "task-123",
    assertionVerified: true,
    approval: {
      approvalMethod: "capability_grant",
      approvalChannel: "grant",
      capability: "purchase",
      constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
      grantId: "grant-123",
    },
    attestationProvider: "AgentPass",
    attestationTier: "attested",
  });

  const { status, json } = await postTokenWithDpop({
    grant_type: CIBA_GRANT_TYPE,
    auth_req_id: authReqId,
    client_id: AGENT_CLIENT_ID,
    client_secret: AGENT_CLIENT_SECRET,
  });
  if (status !== 200) {
    throw new Error(`Expected CIBA token issuance to succeed, got ${status}`);
  }
  return json.access_token as string;
}

async function issueCallerToken(clientId: string, clientSecret: string) {
  const { status, json, dpopKeyPair } = await postTokenWithDpop({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "agent:introspect",
    resource: RP_API_AUDIENCE,
  });
  if (status !== 200) {
    throw new Error(`Expected caller token issuance to succeed, got ${status}`);
  }
  return { keyPair: dpopKeyPair, token: json.access_token as string };
}

async function introspect(
  token: string | null,
  caller?: { keyPair: DpopKeyPair; token: string }
) {
  const { POST } = await import("@/app/api/auth/agent/introspect/route");
  const introspectUrl = "http://localhost:3000/api/auth/agent/introspect";
  const dpopProof = caller
    ? await buildDpopProof(caller.keyPair, "POST", introspectUrl, caller.token)
    : null;

  const formBody = token ? `token=${encodeURIComponent(token)}` : "";
  const request = new Request(introspectUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(caller
        ? {
            Authorization: `DPoP ${caller.token}`,
            DPoP: dpopProof ?? "",
          }
        : {}),
    },
    body: formBody,
  });

  const response = await POST(request);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

const AUTHORIZATION = {
  capabilities: [
    {
      action: "purchase",
      constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
    },
  ],
  oversight: { approved_at: expect.any(Number), method: "capability_grant" },
  delegation: { depth: 0, max_depth: 1 },
  aap_claims_version: 2,
};

const ZENTITY = {
  attestation: { provider: "AgentPass", tier: "attested", verified: true },
  lifecycle: "active",
};

describe("Agent Introspection", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createAgentClient();
    await createIntrospectorClient();
  });

  it("returns 401 without machine authentication", async () => {
    const result = await introspect("fake");
    expect(result.status).toBe(401);
  });

  it("returns inactive for unknown presented tokens", async () => {
    const caller = await issueCallerToken(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET);
    const result = await introspect("not-a-real-token", caller);
    expect(result).toEqual({ status: 200, body: { active: false } });
  });

  // R7: an introspector that neither holds the token nor serves its audience
  // learns nothing about it.
  it.each(["mcp", "zentity"] as const)(
    "answers an unrelated introspector of a %s token with a bare inactive",
    async (audience) => {
      const agent = await createRegisteredAgent(userId);
      const token = await issueAgentToken(userId, agent, audience);
      const caller = await issueCallerToken(
        INTROSPECTOR_CLIENT_ID,
        INTROSPECTOR_SECRET
      );

      expect(await introspect(token, caller)).toEqual({
        status: 200,
        body: { active: false },
      });
    }
  );

  it("gives the issuing client the JWT's own subjects and the approval", async () => {
    const agent = await createRegisteredAgent(userId);
    const token = await issueAgentToken(userId, agent, "mcp");
    const caller = await issueCallerToken(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET);

    const result = await introspect(token, caller);

    const claims = decodeJwt(token);
    expect(result).toEqual({
      status: 200,
      body: {
        active: true,
        client_id: AGENT_CLIENT_ID,
        scope: "openid",
        sub: claims.sub,
        aud: claims.aud,
        iat: claims.iat,
        exp: claims.exp,
        act: claims.act,
        ...AUTHORIZATION,
        zentity: ZENTITY,
      },
    });
    expect(result.body.act).toEqual({
      sub: await pairwiseValue(
        `${AGENT_SECTOR} ${env.MCP_PUBLIC_URL}`,
        agent.sessionId
      ),
      sub_profile: "service",
    });
    expect(JSON.stringify(result.body)).not.toContain(agent.sessionId);
    expect(JSON.stringify(result.body)).not.toContain(agent.hostId);
    expect(JSON.stringify(result.body)).not.toContain(userId);
  });

  it("gives a resource server linked to the token's audience the same view", async () => {
    await db
      .insert(oauthClientResources)
      .values({
        id: "mcp-link",
        clientId: INTROSPECTOR_CLIENT_ID,
        resourceId: env.MCP_PUBLIC_URL,
      })
      .run();
    const agent = await createRegisteredAgent(userId);
    const token = await issueAgentToken(userId, agent, "mcp");
    const caller = await issueCallerToken(
      INTROSPECTOR_CLIENT_ID,
      INTROSPECTOR_SECRET
    );

    const result = await introspect(token, caller);

    expect(result.body).toEqual(
      expect.objectContaining({
        active: true,
        sub: decodeJwt(token).sub,
        act: decodeJwt(token).act,
      })
    );
  });

  it("names the user of an opaque token by the issuing client's subject", async () => {
    const agent = await createRegisteredAgent(userId);
    const token = await issueAgentToken(userId, agent, "zentity");
    const caller = await issueCallerToken(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET);

    const result = await introspect(token, caller);

    expect(token.split(".")).toHaveLength(1);
    expect(result.body).toEqual(
      expect.objectContaining({
        active: true,
        sub: await pairwiseValue(AGENT_SECTOR, userId),
        act: {
          sub: await pairwiseValue(AGENT_SECTOR, agent.sessionId),
          sub_profile: "service",
        },
        ...AUTHORIZATION,
        zentity: ZENTITY,
      })
    );
    expect(result.body).not.toHaveProperty("aud");
  });

  it.each([
    [
      "an expired session",
      {
        createdAt: new Date(Date.now() - 7_200_000),
        idleTtlSec: 60,
        lastActiveAt: new Date(Date.now() - 7_200_000),
        maxLifetimeSec: 86_400,
      },
    ],
    ["a revoked session", { status: "revoked" as const }],
  ])("answers for %s with a bare inactive", async (_case, overrides) => {
    const agent = await createRegisteredAgent(userId, overrides);
    const token = await issueAgentToken(userId, agent, "mcp");
    const caller = await issueCallerToken(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET);

    expect(await introspect(token, caller)).toEqual({
      status: 200,
      body: { active: false },
    });
  });

  it("answers a token without a verified agent with a bare inactive", async () => {
    const { authReqId } = await createTestCibaRequest({
      clientId: AGENT_CLIENT_ID,
      userId,
      status: "approved",
      resources: JSON.stringify([env.MCP_PUBLIC_URL]),
    });
    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: AGENT_CLIENT_ID,
      client_secret: AGENT_CLIENT_SECRET,
    });
    const caller = await issueCallerToken(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET);

    expect(await introspect(json.access_token as string, caller)).toEqual({
      status: 200,
      body: { active: false },
    });
  });
});
