import { decodeJwt } from "jose";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => {
  process.env.WALLET_AUDIENCE = "urn:zentity:wallet:unlinkability-test";
  return { walletAudience: process.env.WALLET_AUDIENCE };
});
vi.mock("@/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/env")>();
  return {
    ...mod,
    env: new Proxy(mod.env, {
      get(target, prop) {
        return prop === "WALLET_AUDIENCE"
          ? mockEnv.walletAudience
          : Reflect.get(target, prop);
      },
    }),
  };
});

import crypto from "node:crypto";

import { env } from "@/env";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaApprovals } from "@/lib/db/schema/ciba";
import { oauthClients, pairwiseSubjects } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const CLIENT_ID = "unlinkability-agent";
const CLIENT_SECRET = "unlinkability-agent-secret";
const WALLET_AUDIENCE = mockEnv.walletAudience;
const PAYMENT_RAR = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50000000", unit: "base" },
  payment_id: "pay_unlinkability",
  intent_hash: `v1:sha256:${"B".repeat(43)}`,
  expires_at: { kind: "block_height", value: 4_056_276 },
};

/** Every string leaf of a decoded artifact, keyed by its claim path. */
function stringLeaves(
  value: unknown,
  path = ""
): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    return [{ path, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => stringLeaves(entry, path));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      stringLeaves(entry, path ? `${path}.${key}` : key)
    );
  }
  return [];
}

async function insertClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: CLIENT_ID,
      name: "Unlinkability Agent",
      clientSecret: crypto
        .createHash("sha256")
        .update(CLIENT_SECRET)
        .digest("base64url"),
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE, "client_credentials"]),
      clientCredentialsScopes: JSON.stringify(["agent:introspect"]),
      scopes: JSON.stringify(["openid", "compliance:read", "agent:introspect"]),
      tokenEndpointAuthMethod: "client_secret_post",
      subjectType: "pairwise",
      sectorIdentifier: `client/${CLIENT_ID}`,
      metadata: JSON.stringify({
        backchannel_token_delivery_mode: "poll",
        authorization_details_types: ["payment_authorization"],
      }),
    })
    .run();
}

async function createHostWithSessions(userId: string, count: number) {
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId: CLIENT_ID,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
      publicKeyThumbprint: `host-${crypto.randomUUID()}`,
      name: "Unlinkability Host",
      attestationProvider: "AgentPass",
      attestationTier: "attested",
    })
    .returning({ id: agentHosts.id });
  const hostId = host?.id as string;
  const sessionIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const [session] = await db
      .insert(agentSessions)
      .values({
        hostId,
        publicKey: JSON.stringify({
          crv: "Ed25519",
          kty: "OKP",
          x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
        publicKeyThumbprint: `agent-${crypto.randomUUID()}`,
        displayName: `Agent ${index}`,
      })
      .returning({ id: agentSessions.id });
    sessionIds.push(session?.id as string);
  }
  return { hostId, sessionIds };
}

describe("actor unlinkability", () => {
  let userId: string;
  let dpopKeyPair: DpopKeyPair;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await insertClient();
    dpopKeyPair = await createTestDpopKeyPair();
  });

  async function approveAndPoll(input: {
    authorizationDetails?: unknown[];
    grant?: { grantId: string; hostPolicyId: string };
    hostId: string;
    resources?: string[];
    scope?: string;
    sessionId: string;
  }) {
    const scope = input.scope ?? "openid";
    const authorizationDetails = input.authorizationDetails
      ? JSON.stringify(input.authorizationDetails)
      : null;
    const request = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
      scope,
      status: "approved",
      ...(input.resources
        ? { resources: JSON.stringify(input.resources) }
        : {}),
      authorizationDetails,
      agentSessionId: input.sessionId,
      hostId: input.hostId,
      assertionVerified: true,
      attestationProvider: "AgentPass",
      attestationTier: "attested",
      taskId: `task-${crypto.randomUUID()}`,
      taskHash: crypto.randomBytes(32).toString("hex"),
      approval: {
        authorizationDetails,
        attestationProvider: "AgentPass",
        attestationTier: "attested",
        ...(input.grant
          ? {
              approvalMethod: "capability_grant",
              approvalChannel: "grant",
              capability: "check_compliance",
              grantId: input.grant.grantId,
              hostPolicyId: input.grant.hostPolicyId,
            }
          : {}),
      },
    });
    const token = await postTokenWithDpop(
      {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: request.authReqId,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      dpopKeyPair
    );
    if (token.status !== 200) {
      throw new Error(`token poll answered ${token.status}`);
    }
    return { ...request, json: token.json };
  }

  // R3: an approval id that fell back to the host policy, or any host-level
  // value, would link two sessions of one installation.
  it("gives two grant approvals from two sessions of one host no shared agent value", async () => {
    const { hostId, sessionIds } = await createHostWithSessions(userId, 2);
    const grant = { grantId: "grant-shared", hostPolicyId: "policy-shared" };
    const tokens: Awaited<ReturnType<typeof approveAndPoll>>[] = [];
    for (const sessionId of sessionIds) {
      tokens.push(
        await approveAndPoll({
          sessionId,
          hostId,
          grant,
          resources: [env.MCP_PUBLIC_URL],
          scope: "openid compliance:read",
        })
      );
    }
    const [first, second] = tokens.map((token) =>
      decodeJwt(token.json.access_token as string)
    );

    expect(first?.act).not.toEqual(second?.act);
    const firstLeaves = stringLeaves(first);
    const shared = stringLeaves(second).filter((leaf) =>
      firstLeaves.some(
        (other) => other.path === leaf.path && other.value === leaf.value
      )
    );
    // The same user at the same client and audience keeps one subject, and
    // the remaining equal values are D33's residuals.
    expect(new Set(shared.map((leaf) => leaf.path))).toEqual(
      new Set([
        "iss",
        "sub",
        "aud",
        "azp",
        "client_id",
        "scope",
        "act.sub_profile",
        "cnf.jkt",
      ])
    );
    const serialized = JSON.stringify([first, second]);
    for (const secret of [
      hostId,
      ...sessionIds,
      grant.grantId,
      grant.hostPolicyId,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  // R6: the actor needs no reverse index; the token's approval record names
  // the agent.
  it("indexes no agent subject and records each token on its approval", async () => {
    const { hostId, sessionIds } = await createHostWithSessions(userId, 1);
    const sessionId = sessionIds[0] as string;
    const mcp = await approveAndPoll({
      sessionId,
      hostId,
      resources: [env.MCP_PUBLIC_URL],
    });
    const wallet = await approveAndPoll({
      sessionId,
      hostId,
      resources: [WALLET_AUDIENCE],
      authorizationDetails: [PAYMENT_RAR],
    });
    const opaque = await approveAndPoll({ sessionId, hostId });

    expect(
      (await db.select().from(pairwiseSubjects).all()).filter(
        (row) => (row.subjectType as string) !== "user"
      )
    ).toEqual([]);
    expectTypeOf<
      (typeof pairwiseSubjects.$inferInsert)["subjectType"]
    >().toEqualTypeOf<"user">();
    const records = await db.select().from(cibaApprovals).all();
    const byReference = new Map(records.map((row) => [row.referenceId, row]));
    for (const [token, audience] of [
      [mcp, env.MCP_PUBLIC_URL],
      [wallet, WALLET_AUDIENCE],
    ] as const) {
      const claims = decodeJwt(token.json.access_token as string);
      expect(byReference.get(token.authReqIdHash)).toMatchObject({
        tokenJti: claims.jti,
        tokenIssuedAt: new Date((claims.iat ?? 0) * 1000),
      });
      expect(
        JSON.parse(byReference.get(token.authReqIdHash)?.tokenAudience ?? "[]")
      ).toContain(audience);
    }
    expect(byReference.get(opaque.authReqIdHash)).toMatchObject({
      tokenJti: null,
      tokenIssuedAt: expect.any(Date),
    });
  });

  async function introspectAsClient(token: string) {
    const caller = await postTokenWithDpop({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "agent:introspect",
      resource: `${getAuthIssuer()}/resource/rp-api`,
    });
    const { POST } = await import("@/app/api/auth/agent/introspect/route");
    const url = "http://localhost:3000/api/auth/agent/introspect";
    const callerToken = caller.json.access_token as string;
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `DPoP ${callerToken}`,
          DPoP: await buildDpopProof(
            caller.dpopKeyPair,
            "POST",
            url,
            callerToken
          ),
        },
        body: new URLSearchParams({ token }),
      })
    );
    return (await response.json()) as Record<string, unknown>;
  }

  // R12: only the residual correlators D33 lists may repeat across the
  // artifacts one session's approvals produce for different audiences.
  it("shares no identifier across audiences beyond the listed residuals", async () => {
    const { hostId, sessionIds } = await createHostWithSessions(userId, 1);
    const sessionId = sessionIds[0] as string;
    const approvals = {
      mcp: await approveAndPoll({
        sessionId,
        hostId,
        resources: [env.MCP_PUBLIC_URL],
      }),
      wallet: await approveAndPoll({
        sessionId,
        hostId,
        resources: [WALLET_AUDIENCE],
        authorizationDetails: [PAYMENT_RAR],
      }),
      zentity: await approveAndPoll({ sessionId, hostId }),
    };

    // Each artifact belongs to the audience that reads it. The client reads
    // its ID tokens, token responses, and the introspection of an opaque
    // token, whose subject is the client's own.
    const artifacts: Array<{ audience: string; value: unknown }> = [];
    for (const [name, approval] of Object.entries(approvals)) {
      const accessToken = approval.json.access_token as string;
      const {
        access_token: _token,
        id_token: idToken,
        ...response
      } = approval.json;
      const introspection = await introspectAsClient(accessToken);
      expect(introspection.active).toBe(true);
      artifacts.push(
        { audience: "client", value: decodeJwt(idToken as string) },
        { audience: "client", value: response },
        { audience: name === "zentity" ? "client" : name, value: introspection }
      );
      if (name !== "zentity") {
        artifacts.push({ audience: name, value: decodeJwt(accessToken) });
      }
    }

    const residuals = new Set([
      "iss",
      "azp",
      "client_id",
      "cnf.jkt",
      "grant_id",
      "sid",
      "reference_id",
      // Public constants and coarse descriptors rather than identifiers.
      "aud",
      "scope",
      "act.sub_profile",
      "token_type",
      "oversight.method",
      "capabilities.action",
      "zentity.attestation.provider",
      "zentity.attestation.tier",
      "zentity.lifecycle",
    ]);
    // The payment terms the client sent reach the wallet by design.
    const isApprovedTerms = (path: string) =>
      path.startsWith("authorization_details");
    const leaves = artifacts.flatMap(({ audience, value }) =>
      stringLeaves(value).map((leaf) => ({ ...leaf, audience }))
    );
    const crossAudience = leaves.filter((leaf) =>
      leaves.some(
        (other) =>
          other.audience !== leaf.audience && other.value === leaf.value
      )
    );
    expect(
      [...new Set(crossAudience.map((leaf) => leaf.path))].filter(
        (path) => !(residuals.has(path) || isApprovedTerms(path))
      )
    ).toEqual([]);

    // The user and the agent each get one value per audience.
    const subjects = (path: string) =>
      new Set(
        leaves.filter((leaf) => leaf.path === path).map((leaf) => leaf.audience)
      ).size;
    expect(subjects("sub")).toBe(3);
    expect(subjects("act.sub")).toBe(3);

    // No server-side identifier reaches any artifact.
    const records = await db.select().from(cibaApprovals).all();
    const serialized = JSON.stringify(artifacts.map(({ value }) => value));
    for (const secret of [
      userId,
      sessionId,
      hostId,
      ...records.flatMap((row) => [
        row.id,
        row.requestId,
        row.authContextId ?? "absent",
      ]),
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
