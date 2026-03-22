import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { bindAgentAssertionToCibaRequest } from "@/lib/ciba/agent-binding";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { ensureCapabilitiesSeeded } from "@/lib/db/seed/capabilities";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const TEST_CLIENT_ID = "ciba-agent-binding-client";
const OTHER_CLIENT_ID = "ciba-agent-binding-other-client";

async function createOAuthClient(clientId: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
      tokenEndpointAuthMethod: "none",
      public: true,
    })
    .run();
}

async function createRegisteredAgent(
  userId: string,
  clientId = TEST_CLIENT_ID
) {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);

  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId,
      publicKey: JSON.stringify({ crv: "Ed25519", kty: "OKP", x: "host" }),
      publicKeyThumbprint: `host-thumbprint-${crypto.randomUUID()}`,
      name: "Test Host",
      attestationProvider: "AgentPass",
      attestationTier: "attested",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected host fixture to be created");
  }

  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host.id,
      publicKey: JSON.stringify(publicJwk),
      publicKeyThumbprint: `agent-thumbprint-${crypto.randomUUID()}`,
      displayName: "Claude Code",
      runtime: "node",
      model: "claude",
      version: "1.2.3",
    })
    .returning({ id: agentSessions.id });
  if (!session) {
    throw new Error("Expected session fixture to be created");
  }

  return {
    hostId: host.id,
    privateKey,
    sessionId: session.id,
  };
}

async function insertCibaRequest(params: {
  authReqId?: string;
  bindingMessage?: string;
  clientId?: string;
  scope: string;
  userId: string;
}) {
  const authReqId = params.authReqId ?? crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      authReqId,
      clientId: params.clientId ?? TEST_CLIENT_ID,
      userId: params.userId,
      scope: params.scope,
      status: "pending",
      bindingMessage: params.bindingMessage ?? null,
      expiresAt: new Date(Date.now() + 300_000),
    })
    .run();
  return authReqId;
}

function signAssertion(params: {
  bindingMessage: string;
  hostId: string;
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  sessionId: string;
}) {
  const taskHash = crypto
    .createHash("sha256")
    .update(params.bindingMessage)
    .digest("hex");

  return new SignJWT({
    host_id: params.hostId,
    task_hash: taskHash,
    task_id: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent-assertion+jwt" })
    .setIssuer(params.sessionId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(params.privateKey);
}

describe("bindAgentAssertionToCibaRequest", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await ensureCapabilitiesSeeded();
    userId = await createTestUser();
    await createOAuthClient(TEST_CLIENT_ID);
    await createOAuthClient(OTHER_CLIENT_ID);
  });

  it("binds a verified assertion to the canonical CIBA request snapshot", async () => {
    const bindingMessage = "Claude Code: Unlock identity for this session";
    const agent = await createRegisteredAgent(userId);
    const assertionJwt = await signAssertion({
      bindingMessage,
      hostId: agent.hostId,
      privateKey: agent.privateKey,
      sessionId: agent.sessionId,
    });
    const authReqId = await insertCibaRequest({
      bindingMessage,
      scope: "openid identity.name identity.address",
      userId,
    });

    const result = await bindAgentAssertionToCibaRequest({
      assertionJwt,
      authReqId,
      authorizationDetails: [],
      scope: "openid identity.name identity.address",
    });

    expect(result?.sessionId).toBe(agent.sessionId);
    expect(result?.registeredAgent.name).toBe("Claude Code");

    const updated = await db
      .select({
        agentSessionId: cibaRequests.agentSessionId,
        approvedCapabilityName: cibaRequests.approvedCapabilityName,
        assertionVerified: cibaRequests.assertionVerified,
        hostId: cibaRequests.hostId,
        taskHash: cibaRequests.taskHash,
      })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, authReqId))
      .limit(1)
      .get();

    expect(updated).toEqual(
      expect.objectContaining({
        agentSessionId: agent.sessionId,
        approvedCapabilityName: "read_profile",
        assertionVerified: true,
        hostId: agent.hostId,
      })
    );
    expect(updated?.taskHash).toBeTruthy();
  });

  it("rejects assertions whose host ownership does not match the CIBA request", async () => {
    const bindingMessage = "Claude Code: Unlock identity for this session";
    const agent = await createRegisteredAgent(userId);
    const assertionJwt = await signAssertion({
      bindingMessage,
      hostId: agent.hostId,
      privateKey: agent.privateKey,
      sessionId: agent.sessionId,
    });
    const authReqId = await insertCibaRequest({
      bindingMessage,
      clientId: OTHER_CLIENT_ID,
      scope: "openid identity.name identity.address",
      userId,
    });

    const result = await bindAgentAssertionToCibaRequest({
      assertionJwt,
      authReqId,
      authorizationDetails: [],
      scope: "openid identity.name identity.address",
    });

    expect(result).toBeNull();

    const updated = await db
      .select({
        agentSessionId: cibaRequests.agentSessionId,
        assertionVerified: cibaRequests.assertionVerified,
      })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, authReqId))
      .limit(1)
      .get();

    expect(updated).toEqual({
      agentSessionId: null,
      assertionVerified: null,
    });
  });

  it("rejects assertions whose task hash does not match the current binding message", async () => {
    const agent = await createRegisteredAgent(userId);
    const authReqId = await insertCibaRequest({
      bindingMessage: "Claude Code: Unlock identity for this session",
      scope: "openid identity.name identity.address",
      userId,
    });
    const assertionJwt = await signAssertion({
      bindingMessage: "Claude Code: Something else entirely",
      hostId: agent.hostId,
      privateKey: agent.privateKey,
      sessionId: agent.sessionId,
    });

    const result = await bindAgentAssertionToCibaRequest({
      assertionJwt,
      authReqId,
      authorizationDetails: [],
      scope: "openid identity.name identity.address",
    });

    expect(result).toBeNull();

    const updated = await db
      .select({
        assertionVerified: cibaRequests.assertionVerified,
        taskHash: cibaRequests.taskHash,
      })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, authReqId))
      .limit(1)
      .get();

    expect(updated).toEqual({
      assertionVerified: null,
      taskHash: null,
    });
  });

  it("requires binding_message on the CIBA request to verify Agent-Assertion", async () => {
    const bindingMessage = "Claude Code: Unlock identity for this session";
    const agent = await createRegisteredAgent(userId);
    const assertionJwt = await signAssertion({
      bindingMessage,
      hostId: agent.hostId,
      privateKey: agent.privateKey,
      sessionId: agent.sessionId,
    });
    const authReqId = await insertCibaRequest({
      scope: "openid identity.name",
      userId,
    });

    const result = await bindAgentAssertionToCibaRequest({
      assertionJwt,
      authReqId,
      authorizationDetails: [],
      scope: "openid identity.name",
    });

    expect(result).toBeNull();
  });

  it("rejects replay of the same assertion jti across CIBA requests", async () => {
    const bindingMessage = "Claude Code: Unlock identity for this session";
    const agent = await createRegisteredAgent(userId);
    const assertionJwt = await signAssertion({
      bindingMessage,
      hostId: agent.hostId,
      privateKey: agent.privateKey,
      sessionId: agent.sessionId,
    });

    const firstAuthReqId = await insertCibaRequest({
      bindingMessage,
      scope: "openid identity.name",
      userId,
    });
    const secondAuthReqId = await insertCibaRequest({
      bindingMessage,
      scope: "openid identity.name",
      userId,
    });

    const firstResult = await bindAgentAssertionToCibaRequest({
      assertionJwt,
      authReqId: firstAuthReqId,
      authorizationDetails: [],
      scope: "openid identity.name",
    });
    expect(firstResult?.sessionId).toBe(agent.sessionId);

    const replayResult = await bindAgentAssertionToCibaRequest({
      assertionJwt,
      authReqId: secondAuthReqId,
      authorizationDetails: [],
      scope: "openid identity.name",
    });
    expect(replayResult).toBeNull();

    const secondRequest = await db
      .select({
        agentSessionId: cibaRequests.agentSessionId,
        assertionVerified: cibaRequests.assertionVerified,
      })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, secondAuthReqId))
      .limit(1)
      .get();

    expect(secondRequest).toEqual({
      agentSessionId: null,
      assertionVerified: null,
    });
  });
});
