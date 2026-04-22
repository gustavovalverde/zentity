import crypto from "node:crypto";

import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveAgentSubForClient } from "@/lib/agents/actor-subject";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
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
const TEST_CLIENT_ID = "ciba-test-agent";
const INTROSPECTOR_CLIENT_ID = "agent-introspector";
const TEST_RESOURCE = "http://localhost:3000/api/auth";
const RP_API_AUDIENCE = `${getAuthIssuer()}/resource/rp-api`;
const HOST_DID = encodeEd25519DidKeyFromJwk({
  crv: "Ed25519",
  kty: "OKP",
  x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
});

async function createOAuthClient(
  clientId: string,
  grantTypes: string[],
  scopes: string[] = ["openid"],
  options?: {
    clientSecret?: string;
    public?: boolean;
    redirectUris?: string[];
    subjectType?: "pairwise" | "public";
    tokenEndpointAuthMethod?: "client_secret_post" | "none";
  }
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify(
        options?.redirectUris ?? ["http://localhost/callback"]
      ),
      grantTypes: JSON.stringify(grantTypes),
      tokenEndpointAuthMethod: options?.tokenEndpointAuthMethod ?? "none",
      public: options?.public ?? true,
      subjectType: options?.subjectType,
      ...(options?.clientSecret
        ? {
            clientSecret: crypto
              .createHash("sha256")
              .update(options.clientSecret)
              .digest("base64url"),
          }
        : {}),
      scopes: JSON.stringify(scopes),
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
      clientId: TEST_CLIENT_ID,
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

async function issueAgentToken(
  userId: string,
  sessionId: string,
  hostId: string
) {
  const { authContextId, authReqId } = await createTestCibaRequest({
    clientId: TEST_CLIENT_ID,
    userId,
    scope: "openid",
    status: "approved",
    resource: TEST_RESOURCE,
    hostId,
    agentSessionId: sessionId,
    displayName: "Test Agent",
    runtime: "test-runner",
    model: "gpt-4",
    version: "1.0.0",
    taskId: "task-123",
    assertionVerified: true,
    approvedCapabilityName: "purchase",
    approvedConstraints: JSON.stringify([
      { field: "merchant", op: "eq", value: "Test Store" },
    ]),
    approvedGrantId: "grant-123",
    approvalStrength: "session",
    attestationProvider: "AgentPass",
    attestationTier: "attested",
  });

  const { status, json } = await postTokenWithDpop({
    grant_type: CIBA_GRANT_TYPE,
    auth_req_id: authReqId,
    client_id: TEST_CLIENT_ID,
  });
  if (status !== 200) {
    throw new Error(`Expected CIBA token issuance to succeed, got ${status}`);
  }

  return {
    accessToken: json.access_token as string,
    authContextId,
    authReqId,
  };
}

async function issueIntrospectorToken() {
  const { status, json, dpopKeyPair } = await postTokenWithDpop({
    grant_type: "client_credentials",
    client_id: INTROSPECTOR_CLIENT_ID,
    client_secret: "introspector-secret",
    scope: "agent:introspect",
    resource: RP_API_AUDIENCE,
  });
  if (status !== 200) {
    throw new Error(
      `Expected introspector token issuance to succeed, got ${status}`
    );
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
    ? await buildDpopProof(caller.keyPair, "POST", introspectUrl)
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

describe("Agent Introspection", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createOAuthClient(TEST_CLIENT_ID, [CIBA_GRANT_TYPE], ["openid"], {
      redirectUris: ["https://agent-client.example.com/callback"],
      subjectType: "pairwise",
    });
    await createOAuthClient(
      INTROSPECTOR_CLIENT_ID,
      ["client_credentials"],
      ["agent:introspect"],
      {
        clientSecret: "introspector-secret",
        public: false,
        tokenEndpointAuthMethod: "client_secret_post",
      }
    );
  });

  it("returns 401 without machine authentication", async () => {
    const result = await introspect("fake");
    expect(result.status).toBe(401);
  });

  it("returns inactive for unknown presented tokens", async () => {
    const caller = await issueIntrospectorToken();
    const result = await introspect("not-a-real-token", caller);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ active: false });
  });

  it("returns top-level AAP claims and zentity lifecycle metadata", async () => {
    const { hostId, sessionId } = await createRegisteredAgent(userId);
    const { accessToken, authContextId, authReqId } = await issueAgentToken(
      userId,
      sessionId,
      hostId
    );
    const caller = await issueIntrospectorToken();

    const result = await introspect(accessToken, caller);
    expect(result.status).toBe(200);
    expect(result.body.active).toBe(true);
    expect(result.body.client_id).toBe(TEST_CLIENT_ID);
    expect(result.body.scope).toBe("openid");

    const expectedActorId = await resolveAgentSubForClient(
      sessionId,
      TEST_CLIENT_ID
    );

    expect(result.body.sub).toBe(userId);
    expect(result.body.act).toEqual({
      did: HOST_DID,
      host_attestation: "attested",
      host_id: hostId,
      session_id: sessionId,
      sub: expectedActorId,
      type: "mcp-agent",
    });
    expect(result.body.task).toEqual({
      constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
      created_at: expect.any(Number),
      description: "purchase",
      expires_at: expect.any(Number),
      hash: expect.any(String),
    });
    expect(result.body.capabilities).toEqual([
      {
        action: "purchase",
        constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
      },
    ]);
    expect(result.body.oversight).toEqual({
      approval_id: "grant-123",
      approved_at: expect.any(Number),
      method: "session",
    });
    expect(result.body.audit).toEqual({
      ciba_request_id: authReqId,
      context_id: authContextId,
      release_id: "dev",
      request_id: authReqId,
    });
    expect(result.body.delegation).toEqual({
      depth: 0,
      max_depth: 1,
      parent_jti: null,
    });
    expect(result.body.aap_claims_version).toBe(1);
    expect(result.body.zentity).toEqual({
      attestation: {
        provider: "AgentPass",
        tier: "attested",
        verified: true,
      },
      lifecycle: {
        created_at: expect.any(Number),
        idle_expires_at: expect.any(Number),
        last_active_at: expect.any(Number),
        max_expires_at: expect.any(Number),
        status: "active",
      },
    });
  });

  it("returns inactive with effective lifecycle metadata for expired sessions", async () => {
    const { hostId, sessionId } = await createRegisteredAgent(userId, {
      createdAt: new Date(Date.now() - 7_200_000),
      idleTtlSec: 60,
      lastActiveAt: new Date(Date.now() - 7_200_000),
      maxLifetimeSec: 86_400,
    });
    const { accessToken } = await issueAgentToken(userId, sessionId, hostId);
    const caller = await issueIntrospectorToken();

    const result = await introspect(accessToken, caller);

    expect(result.status).toBe(200);
    expect(result.body.active).toBe(false);
    expect(result.body.client_id).toBe(TEST_CLIENT_ID);
    expect(result.body.zentity).toEqual({
      attestation: {
        provider: "AgentPass",
        tier: "attested",
        verified: true,
      },
      lifecycle: {
        created_at: expect.any(Number),
        idle_expires_at: expect.any(Number),
        last_active_at: expect.any(Number),
        max_expires_at: expect.any(Number),
        status: "expired",
      },
    });
  });

  it("returns inactive with revoked lifecycle metadata for revoked sessions", async () => {
    const { hostId, sessionId } = await createRegisteredAgent(userId, {
      status: "revoked",
    });
    const { accessToken } = await issueAgentToken(userId, sessionId, hostId);
    const caller = await issueIntrospectorToken();

    const result = await introspect(accessToken, caller);

    expect(result.status).toBe(200);
    expect(result.body.active).toBe(false);
    expect(result.body.zentity).toEqual({
      attestation: {
        provider: "AgentPass",
        tier: "attested",
        verified: true,
      },
      lifecycle: {
        created_at: expect.any(Number),
        idle_expires_at: expect.any(Number),
        last_active_at: expect.any(Number),
        max_expires_at: expect.any(Number),
        status: "revoked",
      },
    });
  });
});
