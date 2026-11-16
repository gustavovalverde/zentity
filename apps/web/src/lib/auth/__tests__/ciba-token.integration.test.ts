import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/auth-context";
import { createCibaApproval } from "@/lib/auth/oidc/ciba";
import { pairwiseValue } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaApprovals, cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaApproval,
  createTestSession,
  createTestUser,
  findStoredOpaqueAccessToken,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "ciba-test-agent";
const TEST_RESOURCE = "http://localhost:3000/api/auth";
let defaultAuthContextId: string;

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "CIBA Test Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE, "refresh_token"]),
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

async function createRegisteredAgent(userId: string) {
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
      hostId: host.id,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
      publicKeyThumbprint: `agent-thumbprint-${crypto.randomUUID()}`,
      displayName: "Test Agent",
      runtime: "test-runner",
      model: "gpt-4",
      version: "1.0.0",
    })
    .returning({ id: agentSessions.id });

  if (!session) {
    throw new Error("Expected registered session fixture to be created");
  }

  return { hostId: host.id, sessionId: session.id };
}

async function insertCibaRequest(
  overrides: Partial<typeof cibaRequests.$inferInsert> = {},
  approval: Parameters<typeof createTestCibaApproval>[0]["overrides"] = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  const status = overrides.status ?? "pending";
  const [row] = await db
    .insert(cibaRequests)
    .values({
      clientId: TEST_CLIENT_ID,
      userId: overrides.userId ?? "test-user",
      scope: "openid",
      status,
      authContextId:
        overrides.authContextId ??
        (status === "approved" ? defaultAuthContextId : undefined),
      expiresAt: new Date(Date.now() + 300_000),
      // A Zentity approval makes the request reference its own hash.
      ...(status === "approved"
        ? { referenceId: hashCibaAuthReqId(authReqId) }
        : {}),
      ...overrides,
      // The CIBA plugin stores the hash of auth_req_id at rest; callers get the
      // raw value to send to the token endpoint, which hashes for lookup.
      authReqId: hashCibaAuthReqId(authReqId),
    })
    .returning({ id: cibaRequests.id });
  if (status === "approved" && row) {
    await createTestCibaApproval({
      authReqIdHash: hashCibaAuthReqId(authReqId),
      clientId: overrides.clientId ?? TEST_CLIENT_ID,
      requestId: row.id,
      userId: overrides.userId ?? "test-user",
      overrides: {
        authContextId: overrides.authContextId ?? defaultAuthContextId,
        ...approval,
      },
    });
  }
  return authReqId;
}

async function inspectCibaAccessToken(
  accessToken: string,
  authReqId: string,
  userId: string,
  authContextId?: string
) {
  const expectedReference = hashCibaAuthReqId(authReqId);
  if (accessToken.split(".").length === 3) {
    const payload = decodeJwt(accessToken);
    // The AS owns the JWT jti (RFC 9068, unique-random); it is not bound to the
    // auth_req_id. CIBA correlation lives in audit.ciba_request_id (the hash).
    if (typeof payload.jti !== "string" || payload.jti.length === 0) {
      throw new Error("Expected JWT access token to carry a jti");
    }
    if (
      authContextId &&
      payload[AUTHENTICATION_CONTEXT_CLAIM] !== authContextId
    ) {
      throw new Error(
        `Expected JWT auth context ${authContextId}, got ${String(payload[AUTHENTICATION_CONTEXT_CLAIM])}`
      );
    }
    return { kind: "jwt" as const, payload };
  }

  const record = await findStoredOpaqueAccessToken(accessToken);
  if (!record) {
    throw new Error("Expected opaque access token record to exist");
  }
  if (record.referenceId !== expectedReference) {
    throw new Error(
      `Expected opaque token referenceId ${expectedReference}, got ${String(record.referenceId)}`
    );
  }
  if (record.userId !== userId) {
    throw new Error(
      `Expected opaque token userId ${userId}, got ${String(record.userId)}`
    );
  }
  const storedAuthContextId =
    record.accessTokenClaims[AUTHENTICATION_CONTEXT_CLAIM];
  if (authContextId && storedAuthContextId !== authContextId) {
    throw new Error(
      `Expected opaque token auth context ${authContextId}, got ${String(storedAuthContextId)}`
    );
  }
  return { kind: "opaque" as const, record };
}

describe("CIBA token endpoint", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
    defaultAuthContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "ciba_approval",
        referenceType: "ciba_request",
      })
    ).id;
  });

  it("returns authorization_pending for a pending request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "pending" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("authorization_pending");
  });

  it("returns access_denied for a denied request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "denied" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("access_denied");
  });

  it("returns expired_token for an expired request", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("expired_token");
  });

  it("returns a token bound to the approved CIBA request", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect({ status, json }).toMatchObject({ status: 200 });
    expect(typeof json.access_token).toBe("string");
    expect(json.token_type).toBe("DPoP");
    expect(json.expires_in).toBeDefined();

    await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId,
      defaultAuthContextId
    );
  });

  it("issues no refresh token, because the token names its actor", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resources: JSON.stringify([TEST_RESOURCE]),
      scope: "openid offline_access",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json).not.toHaveProperty("refresh_token");
  });

  it("deletes CIBA request after successful token issuance (replay prevention)", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(status).toBe(200);

    const { status: replayStatus, json: replayJson } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(replayStatus).toBe(400);
    expect(replayJson.error).toBe("invalid_grant");
  });

  it("rejects when client_id does not match CIBA request", async () => {
    await db
      .insert(oauthClients)
      .values({
        clientId: "other-agent",
        name: "Other Agent",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
        tokenEndpointAuthMethod: "none",
      })
      .run();

    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: "other-agent",
    });

    expect(status).toBe(400);
    expect(json.error).toBe("invalid_grant");
  });

  it("binds verified agent sessions into the access-token record", async () => {
    const { hostId, sessionId } = await createRegisteredAgent(userId);
    const authReqId = await insertCibaRequest(
      {
        userId,
        status: "approved",
        resources: JSON.stringify([TEST_RESOURCE]),
        hostId,
        agentSessionId: sessionId,
        displayName: "Test Agent",
        model: "gpt-4",
        runtime: "test-runner",
        version: "1.0.0",
        taskId: "task-123",
        assertionVerified: true,
        attestationProvider: "AgentPass",
        attestationTier: "attested",
      },
      {
        approvalMethod: "capability_grant",
        approvalChannel: "grant",
        capability: "purchase",
        constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
        grantId: "grant-123",
        agentSessionId: sessionId,
        hostId,
      }
    );

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const tokenShape = await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId,
      defaultAuthContextId
    );
    expect(tokenShape.kind).toBe("jwt");
    if (tokenShape.kind === "jwt") {
      expect(tokenShape.payload).not.toHaveProperty("agent_sub");
      expect(tokenShape.payload).not.toHaveProperty("zentity_context_id");
      expect(tokenShape.payload).not.toHaveProperty("zentity_release_id");
      // Every audience is Zentity-hosted, so the actor is pairwise in the
      // client's own sector, its first redirect host.
      expect(tokenShape.payload.act).toEqual({
        sub: await pairwiseValue("localhost", sessionId),
        sub_profile: "service",
      });
      expect(tokenShape.payload.task).toEqual({
        constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
        created_at: expect.any(Number),
        description: "purchase",
        expires_at: expect.any(Number),
        hash: expect.any(String),
      });
      expect(tokenShape.payload.capabilities).toEqual([
        {
          action: "purchase",
          constraints: [{ field: "merchant", op: "eq", value: "Test Store" }],
        },
      ]);
      expect(tokenShape.payload.oversight).toEqual({
        approval_id: "grant-123",
        approved_at: expect.any(Number),
        method: "capability_grant",
      });
      // auth_req_id is hashed at rest (it is a bearer credential); the audit
      // correlation claim carries the hash, never the raw value.
      const authReqIdHash = hashCibaAuthReqId(authReqId);
      expect(tokenShape.payload.audit).toEqual({
        ciba_request_id: authReqIdHash,
        context_id: defaultAuthContextId,
        release_id: "dev",
        request_id: authReqIdHash,
      });
      expect(tokenShape.payload.delegation).toEqual({
        depth: 0,
        max_depth: 1,
        parent_jti: null,
      });
      expect(tokenShape.payload.aap_claims_version).toBe(1);
    }
  });

  it("does not emit agent claims for plain CIBA requests", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      resources: JSON.stringify([TEST_RESOURCE]),
    });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const tokenShape = await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId,
      defaultAuthContextId
    );
    if (tokenShape.kind === "jwt") {
      expect(tokenShape.payload).not.toHaveProperty("agent_sub");
      expect(tokenShape.payload).not.toHaveProperty("zentity_context_id");
      expect(tokenShape.payload).not.toHaveProperty("zentity_release_id");
      expect(tokenShape.payload.act).toEqual({
        sub: TEST_CLIENT_ID,
        sub_profile: "service",
      });
      expect(tokenShape.payload.task).toBeUndefined();
      expect(tokenShape.payload.capabilities).toBeUndefined();
      expect(tokenShape.payload.oversight).toBeUndefined();
      expect(tokenShape.payload.audit).toBeUndefined();
      expect(tokenShape.payload.delegation).toBeUndefined();
    }
  });

  it("stores the actor on an opaque CIBA token for introspection", async () => {
    const authReqId = await insertCibaRequest({ userId, status: "approved" });

    const { json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    const tokenShape = await inspectCibaAccessToken(
      json.access_token as string,
      authReqId,
      userId
    );
    expect(tokenShape.kind).toBe("opaque");
    if (tokenShape.kind === "opaque") {
      expect(tokenShape.record.act).toEqual({
        sub: TEST_CLIENT_ID,
        sub_profile: "service",
      });
    }
  });
});

describe("CIBA decision record", () => {
  let userId: string;
  let sessionCookie: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
    const { token } = await createTestSession(userId);
    sessionCookie = `better-auth.session_token=${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
  });

  async function pendingRequest(
    overrides: Partial<typeof cibaRequests.$inferInsert> = {}
  ) {
    const authReqId = await insertCibaRequest({
      userId,
      scope: "openid compliance:read",
      bindingMessage: "Check compliance for checkout",
      authorizationDetails: null,
      ...overrides,
    });
    const row = await db
      .select({ id: cibaRequests.id })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
      .get();
    if (!row) {
      throw new Error("Expected pending request");
    }
    return { authReqId, requestId: row.id };
  }

  function decide(requestId: string, decision: "approved" | "denied") {
    return auth.handler(
      new Request("http://localhost:3000/api/auth/ciba/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          request_id: requestId,
          decision,
          channel: "page",
        }),
      })
    );
  }

  function records(authReqId: string) {
    return db
      .select()
      .from(cibaApprovals)
      .where(eq(cibaApprovals.referenceId, hashCibaAuthReqId(authReqId)))
      .all();
  }

  // R16: approval facts outlive the request row the plugin deletes.
  it("keeps the approval after the token poll consumes the request", async () => {
    const { authReqId, requestId } = await pendingRequest();

    expect((await decide(requestId, "approved")).status).toBe(200);
    const poll = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });
    expect(poll.status).toBe(200);

    expect(
      await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.id, requestId))
        .all()
    ).toHaveLength(0);
    expect(await records(authReqId)).toEqual([
      expect.objectContaining({
        requestId,
        userId,
        clientId: TEST_CLIENT_ID,
        decision: "approved",
        approvalMethod: "session",
        approvalChannel: "page",
        scope: "openid compliance:read",
        bindingMessage: "Check compliance for checkout",
        authorizationDetails: null,
        decidedAt: expect.any(Date),
        authContextId: expect.any(String),
      }),
    ]);
  });

  it("lets only one of two concurrent approvals win", async () => {
    const { authReqId, requestId } = await pendingRequest();

    const responses = await Promise.all([
      decide(requestId, "approved"),
      decide(requestId, "approved"),
    ]);

    expect(responses.map((response) => response.status).toSorted()).toEqual([
      200, 400,
    ]);
    const loser = responses.find((response) => response.status === 400);
    expect(((await loser?.json()) as { error?: string }).error).toBe(
      "invalid_request"
    );
    expect(await records(authReqId)).toHaveLength(1);
  });

  it("writes a record for a denial", async () => {
    const { authReqId, requestId } = await pendingRequest();

    expect((await decide(requestId, "denied")).status).toBe(200);

    expect(await records(authReqId)).toEqual([
      expect.objectContaining({
        decision: "denied",
        approvalMethod: null,
        approvalChannel: "page",
      }),
    ]);
  });

  // R24: a failed completion leaves no record and a decidable request.
  it("removes the record when the plugin cannot complete the approval", async () => {
    const { authReqId, requestId } = await pendingRequest();
    const authentication = await createAuthenticationContext({
      userId,
      loginMethod: "passkey",
      authenticatedAt: new Date(),
      sourceKind: "better_auth",
    });
    const failing = createCibaApproval(() =>
      Promise.reject(new Error("completion failed"))
    );

    await expect(
      failing.approve({
        requestId,
        userId,
        authentication,
        channel: "page",
        grant: { method: "session" },
      })
    ).rejects.toThrow("completion failed");

    expect(await records(authReqId)).toEqual([]);
    const row = await db
      .select({ status: cibaRequests.status })
      .from(cibaRequests)
      .where(eq(cibaRequests.id, requestId))
      .get();
    expect(row?.status).toBe("pending");

    expect((await decide(requestId, "approved")).status).toBe(200);
    expect(await records(authReqId)).toHaveLength(1);
  });

  // R6: the record says how and where the user decided.
  it.each(["page", "push", "email"] as const)(
    "records a session approval through the %s channel",
    async (channel) => {
      const { authReqId, requestId } = await pendingRequest();

      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/ciba/decision", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: sessionCookie,
          },
          body: JSON.stringify({
            request_id: requestId,
            decision: "approved",
            channel,
          }),
        })
      );

      expect(response.status).toBe(200);
      expect(await records(authReqId)).toEqual([
        expect.objectContaining({
          approvalMethod: "session",
          approvalChannel: channel,
        }),
      ]);
    }
  );

  // R8: approved_at is the decision time, not the request's creation time.
  it("states the decision time as approved_at in the token response and the agent token", async () => {
    const createdAt = new Date("2026-11-15T10:00:00.000Z");
    const decidedAt = new Date(createdAt.getTime() + 60_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(createdAt);
      const { hostId, sessionId } = await createRegisteredAgent(userId);
      const { token } = await createTestSession(userId);
      sessionCookie = `better-auth.session_token=${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
      const { authReqId, requestId } = await pendingRequest({
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 300_000),
        resources: JSON.stringify([TEST_RESOURCE]),
        hostId,
        agentSessionId: sessionId,
        displayName: "Test Agent",
        assertionVerified: true,
        attestationTier: "attested",
      });

      vi.setSystemTime(decidedAt);
      expect((await decide(requestId, "approved")).status).toBe(200);
      const { status, json } = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: TEST_CLIENT_ID,
      });

      expect(status).toBe(200);
      const approvedAt = Math.floor(decidedAt.getTime() / 1000);
      expect(json.oversight).toEqual({
        method: "session",
        approved_at: approvedAt,
      });
      const accessToken = json.access_token as string;
      const tokenClaims =
        accessToken.split(".").length === 3
          ? decodeJwt(accessToken)
          : (await findStoredOpaqueAccessToken(accessToken))?.accessTokenClaims;
      expect(tokenClaims?.oversight).toEqual(
        expect.objectContaining({
          approved_at: approvedAt,
          method: "session",
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
