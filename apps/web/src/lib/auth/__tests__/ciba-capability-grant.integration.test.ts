import crypto from "node:crypto";

import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { eq } from "drizzle-orm";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.WALLET_AUDIENCE = "urn:zentity:wallet:capability-grant-test";
});

import { ensureCapabilitiesSeeded } from "@/lib/agents/capability";
import { auth } from "@/lib/auth/auth-config";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/auth-context";
import { PAYMENT_AUTHORIZATION_SCOPE } from "@/lib/auth/oidc/payment-mint";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import {
  agentHostPolicies,
  agentHosts,
  agentSessions,
  capabilityUsageLedger,
} from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  oauthAccessTokens,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const APP_URL = "http://localhost:3000";
const BC_AUTHORIZE_URL = `${APP_URL}/api/auth/oauth2/bc-authorize`;
const SESSION_REGISTER_URL = `${APP_URL}/api/auth/agent/register`;
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const CLIENT_ID = "capability-grant-agent";
const BOOTSTRAP_SCOPE = "agent:host.register agent:session.register";
const BINDING_MESSAGE = "Check compliance for checkout";

type HostPolicyFixture = Omit<typeof agentHostPolicies.$inferInsert, "hostId">;
type Ed25519KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

interface RegisteredAgent {
  hostId: string;
  privateKey: Ed25519KeyPair["privateKey"];
  sessionId: string;
}

function hashOpaqueAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

async function createAgentClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: CLIENT_ID,
      name: "Capability Grant Agent",
      redirectUris: JSON.stringify(["http://localhost:3100/callback"]),
      grantTypes: JSON.stringify([
        "authorization_code",
        CIBA_GRANT_TYPE,
        TOKEN_EXCHANGE_GRANT_TYPE,
      ]),
      tokenEndpointAuthMethod: "none",
      metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
    })
    .run();
}

/**
 * The user signs in to the agent's client, which exchanges that login for a
 * bootstrap token. The login's authentication context is what delegating the
 * agent session rests on.
 */
async function issueBootstrapToken(
  userId: string,
  authContextId: string
): Promise<{ dpopKeyPair: DpopKeyPair; token: string }> {
  const loginToken = `login-${crypto.randomUUID()}`;
  await db
    .insert(oauthAccessTokens)
    .values({
      authContextId,
      clientId: CLIENT_ID,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: JSON.stringify(["openid"]),
      token: hashOpaqueAccessToken(loginToken),
      userId,
    })
    .run();

  const dpopKeyPair = await createTestDpopKeyPair();
  const { json, status } = await postTokenWithDpop(
    {
      audience: APP_URL,
      client_id: CLIENT_ID,
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      scope: BOOTSTRAP_SCOPE,
      subject_token: loginToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    },
    dpopKeyPair
  );
  if (status !== 200) {
    throw new Error(`Bootstrap token exchange failed: ${JSON.stringify(json)}`);
  }
  return { dpopKeyPair, token: json.access_token as string };
}

/**
 * Registers a host directly, then an agent session through the real route,
 * which seeds the session's grants from the host's policies.
 */
async function registerAgent(
  userId: string,
  authContextId: string,
  hostPolicies: HostPolicyFixture[] = []
): Promise<RegisteredAgent> {
  const hostKeys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: CLIENT_ID,
      publicKey: JSON.stringify(await exportJWK(hostKeys.publicKey)),
      publicKeyThumbprint: `host-${crypto.randomUUID()}`,
      name: "Checkout Host",
    })
    .returning({ id: agentHosts.id });
  if (!host) {
    throw new Error("Expected host fixture to be created");
  }
  if (hostPolicies.length > 0) {
    await db
      .insert(agentHostPolicies)
      .values(hostPolicies.map((policy) => ({ ...policy, hostId: host.id })))
      .run();
  }

  const agentKeys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const agentJwk = await exportJWK(agentKeys.publicKey);
  const hostJwt = await new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "host-attestation+jwt" })
    .setIssuer(host.id)
    .setSubject("agent-registration")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(hostKeys.privateKey);

  const bootstrap = await issueBootstrapToken(userId, authContextId);
  const proof = await buildDpopProof(
    bootstrap.dpopKeyPair,
    "POST",
    SESSION_REGISTER_URL,
    bootstrap.token
  );
  const { POST } = await import("@/app/api/auth/agent/register/route");
  const response = await POST(
    new Request(SESSION_REGISTER_URL, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${bootstrap.token}`,
        "Content-Type": "application/json",
        DPoP: proof,
      },
      body: JSON.stringify({
        hostJwt,
        did: encodeEd25519DidKeyFromJwk({
          crv: "Ed25519",
          kty: "OKP",
          x: agentJwk.x as string,
        }),
        display: { name: "Checkout Agent", runtime: "node" },
      }),
    })
  );
  if (response.status !== 201) {
    throw new Error(`Session registration failed: ${await response.text()}`);
  }
  const { sessionId } = (await response.json()) as { sessionId: string };
  return { hostId: host.id, privateKey: agentKeys.privateKey, sessionId };
}

function signAgentAssertion(agent: RegisteredAgent): Promise<string> {
  return new SignJWT({
    host_id: agent.hostId,
    task_hash: crypto
      .createHash("sha256")
      .update(BINDING_MESSAGE)
      .digest("hex"),
    task_id: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent-assertion+jwt" })
    .setIssuer(agent.sessionId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(agent.privateKey);
}

async function requestBackchannelAuth(
  agent: RegisteredAgent,
  userId: string,
  params: Record<string, string>
): Promise<string> {
  const response = await auth.handler(
    new Request(BC_AUTHORIZE_URL, {
      method: "POST",
      headers: {
        "Agent-Assertion": await signAgentAssertion(agent),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        binding_message: BINDING_MESSAGE,
        client_id: CLIENT_ID,
        login_hint: userId,
        ...params,
      }),
    })
  );
  const json = (await response.json()) as Record<string, unknown>;
  if (response.status !== 200) {
    throw new Error(`bc-authorize failed: ${JSON.stringify(json)}`);
  }
  return json.auth_req_id as string;
}

function readRequest(authReqId: string) {
  return db
    .select({
      approvalMethod: cibaRequests.approvalMethod,
      approvedCapabilityName: cibaRequests.approvedCapabilityName,
      approvedHostPolicyId: cibaRequests.approvedHostPolicyId,
      authContextId: cibaRequests.authContextId,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .limit(1)
    .get();
}

function ledgerEntries(sessionId: string) {
  return db
    .select({ capabilityName: capabilityUsageLedger.capabilityName })
    .from(capabilityUsageLedger)
    .where(eq(capabilityUsageLedger.sessionId, sessionId))
    .all();
}

describe("CIBA approval from capability grants", () => {
  let userId: string;
  let delegationAuthContextId: string;
  let delegationAuthenticatedAt: Date;

  beforeEach(async () => {
    await resetDatabase();
    await ensureCapabilitiesSeeded();
    userId = await createTestUser();
    delegationAuthenticatedAt = new Date(Date.now() - 60_000);
    delegationAuthContextId = (
      await createAuthenticationContext({
        authenticatedAt: delegationAuthenticatedAt,
        loginMethod: "passkey",
        sourceKind: "token_exchange",
        userId,
      })
    ).id;
    await createAgentClient();
  });

  it("approves a request within an active grant without asking the user", async () => {
    const agent = await registerAgent(userId, delegationAuthContextId);

    const authReqId = await requestBackchannelAuth(agent, userId, {
      scope: "openid compliance:read",
    });

    const stored = await readRequest(authReqId);
    expect(stored).toEqual(
      expect.objectContaining({
        status: "approved",
        approvalMethod: "capability_grant",
        approvedCapabilityName: "check_compliance",
        approvedHostPolicyId: expect.any(String),
        authContextId: delegationAuthContextId,
      })
    );
    expect(await ledgerEntries(agent.sessionId)).toEqual([
      { capabilityName: "check_compliance" },
    ]);

    const token = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: CLIENT_ID,
    });
    expect(token.status).toBe(200);
    expect(token.json.access_token).toEqual(expect.any(String));

    // The ID token carries the authentication that delegated the agent
    // session, not a fresh login the user never performed.
    const idToken = decodeJwt(token.json.id_token as string);
    expect(idToken[AUTHENTICATION_CONTEXT_CLAIM]).toBe(delegationAuthContextId);
    expect(idToken.auth_time).toBe(
      Math.floor(delegationAuthenticatedAt.getTime() / 1000)
    );
  });

  it("leaves a request pending once the grant's daily limit is used", async () => {
    const agent = await registerAgent(userId, delegationAuthContextId, [
      {
        capabilityName: "check_compliance",
        dailyLimitCount: 1,
        source: "user_grant",
        status: "active",
      },
    ]);

    const first = await requestBackchannelAuth(agent, userId, {
      scope: "openid compliance:read",
    });
    const second = await requestBackchannelAuth(agent, userId, {
      scope: "openid compliance:read",
    });

    expect((await readRequest(first))?.status).toBe("approved");
    expect(await readRequest(second)).toEqual(
      expect.objectContaining({ status: "pending", approvalMethod: null })
    );
    expect(await ledgerEntries(agent.sessionId)).toHaveLength(1);

    const poll = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: second,
      client_id: CLIENT_ID,
    });
    expect(poll.status).toBe(400);
    expect(poll.json.error).toBe("authorization_pending");
  });

  it("asks the user when the agent session has no recorded authentication", async () => {
    const agent = await registerAgent(userId, delegationAuthContextId);
    await db
      .update(agentSessions)
      .set({ authContextId: null })
      .where(eq(agentSessions.id, agent.sessionId))
      .run();

    const authReqId = await requestBackchannelAuth(agent, userId, {
      scope: "openid compliance:read",
    });

    expect(await readRequest(authReqId)).toEqual(
      expect.objectContaining({ status: "pending", approvalMethod: null })
    );
    expect(await ledgerEntries(agent.sessionId)).toEqual([]);
  });

  it("approves a payment only within the grant's amount ceiling", async () => {
    const agent = await registerAgent(userId, delegationAuthContextId, [
      {
        capabilityName: "payment_authorization:sign",
        constraints: JSON.stringify([
          { field: "amount.value", op: "max", value: 100 },
        ]),
        source: "user_grant",
        status: "active",
      },
    ]);
    const payment = (value: string) =>
      JSON.stringify([
        {
          type: "payment_authorization",
          chain: { namespace: "zcash", reference: "test" },
          recipient: "zcash:test:utest1qq0",
          amount: { currency: "ZEC", value, unit: "base" },
          payment_id: `pay_${crypto.randomUUID()}`,
          intent_hash: `v1:sha256:${"A".repeat(43)}`,
          expires_at: { kind: "block_height", value: 4_056_276 },
        },
      ]);

    const overCeiling = await requestBackchannelAuth(agent, userId, {
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      authorization_details: payment("500"),
    });
    const withinCeiling = await requestBackchannelAuth(agent, userId, {
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      authorization_details: payment("50"),
    });

    expect(await readRequest(overCeiling)).toEqual(
      expect.objectContaining({ status: "pending", approvalMethod: null })
    );
    expect(await readRequest(withinCeiling)).toEqual(
      expect.objectContaining({
        status: "approved",
        approvalMethod: "capability_grant",
        approvedCapabilityName: "payment_authorization:sign",
      })
    );
    expect(await ledgerEntries(agent.sessionId)).toEqual([
      { capabilityName: "payment_authorization:sign" },
    ]);
  });
});
