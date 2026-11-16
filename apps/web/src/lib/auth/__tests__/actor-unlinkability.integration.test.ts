import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const CLIENT_ID = "unlinkability-agent";
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
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
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
});
