import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => {
  process.env.WALLET_AUDIENCE = "urn:zentity:wallet:payment-token-test";
  return { walletAudience: process.env.WALLET_AUDIENCE as string | undefined };
});
const notificationMock = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/agents/push-sender", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agents/push-sender")>();
  return {
    ...mod,
    buildCibaPushPayload: (
      ...args: Parameters<typeof mod.buildCibaPushPayload>
    ) => {
      if (notificationMock.fail) {
        throw new Error("notification failed");
      }
      return mod.buildCibaPushPayload(...args);
    },
  };
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

import { PAYMENT_AUTHORIZATION_CAPABILITY } from "@zentity/sdk/protocol";

import { GET as listRevocations } from "@/app/api/auth/oauth2/revoked/route";
import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { createCibaApproval } from "@/lib/auth/oidc/ciba";
import {
  RELEASE_BINDING_CLAIM,
  stageFinalCibaDisclosure,
} from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import { pairwiseValue, resolveSubForClientId } from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients, oauthResources } from "@/lib/db/schema/oauth-provider";
import {
  confirmWithPasskey,
  decisionRecord,
  postDecision,
  requestIdForAuthReqId,
  requestStatus,
  signInApprover,
} from "@/test-utils/ciba-decision-test-utils";
import {
  createTestCibaRequest,
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
  TEST_CIBA_CLIENT_SECRET,
  testCibaClientCredentials,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const WALLET_AUDIENCE = "urn:zentity:wallet:payment-token-test";
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
const REVOKE_URL = "http://localhost:3000/api/auth/oauth2/revoke";
const CLIENT_ID = "payment-token-agent";
const CLIENT_REQUESTED_RESOURCE = "http://localhost:3000";
const AUTH_URL = "http://localhost:3000/api/auth";
const USERINFO_URL = `${AUTH_URL}/oauth2/userinfo`;
const SPIRITS_SCOPE =
  "openid proof:age proof:nationality identity.name identity.address";

const PAYMENT_RAR = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50000000", unit: "base" },
  payment_id: "pay_123",
  intent_hash: `v1:sha256:${"A".repeat(43)}`,
  expires_at: { kind: "block_height", value: 4_056_276 },
};

async function postForm(url: string, body: Record<string, string>) {
  const response = await auth.handler(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  return {
    status: response.status,
    json: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

function postBcAuthorize(body: Record<string, string>) {
  return postForm(BC_AUTHORIZE_URL, {
    client_secret: TEST_CIBA_CLIENT_SECRET,
    ...body,
  });
}

async function insertCibaClient(
  clientId: string,
  metadata: Record<string, unknown>
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Payment Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      ...testCibaClientCredentials,
      subjectType: "pairwise",
      sectorIdentifier: `client/${clientId}`,
      metadata: JSON.stringify({
        backchannel_token_delivery_mode: "poll",
        ...metadata,
      }),
    })
    .run();
}

async function fetchUserInfo(accessToken: string, keyPair: DpopKeyPair) {
  const response = await auth.handler(
    new Request(USERINFO_URL, {
      method: "GET",
      headers: {
        authorization: `DPoP ${accessToken}`,
        DPoP: await buildDpopProof(keyPair, "GET", USERINFO_URL, accessToken),
      },
    })
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function createRegisteredAgent(userId: string) {
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
      name: "Test Host",
    })
    .returning({ id: agentHosts.id });
  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host?.id as string,
      publicKey: JSON.stringify({
        crv: "Ed25519",
        kty: "OKP",
        x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
      publicKeyThumbprint: `agent-${crypto.randomUUID()}`,
      displayName: "Test Agent",
    })
    .returning({ id: agentSessions.id });
  return { hostId: host?.id as string, sessionId: session?.id as string };
}

describe("payment_authorization token", () => {
  let userId: string;
  let loginHint: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    // RFC 9396 §10: a payment client declares the type it requests.
    await insertCibaClient(CLIENT_ID, {
      authorization_details_types: ["payment_authorization"],
    });
    loginHint = (await resolveSubForClientId(userId, CLIENT_ID)) as string;
  });

  afterEach(() => {
    mockEnv.walletAudience = WALLET_AUDIENCE;
    notificationMock.fail = false;
  });

  async function requestPayment(): Promise<string> {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: loginHint,
      authorization_details: JSON.stringify([PAYMENT_RAR]),
    });
    if (authorize.status !== 200) {
      throw new Error(`bc-authorize answered ${authorize.status}`);
    }
    return requestIdForAuthReqId(
      hashCibaAuthReqId(authorize.json.auth_req_id as string)
    );
  }

  // R2 and R3: a session cookie does not approve a payment, with or without
  // an Agent-Assertion (this request carries none).
  it("refuses a manual payment approval without a passkey assertion", async () => {
    await new TestAuthenticator().register(userId);
    const requestId = await requestPayment();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(403);
    expect(response.json).toEqual(
      expect.objectContaining({
        error: "insufficient_user_authentication",
        error_description: "Confirm with your passkey to approve this request",
        approval_requirement: "user_verification",
      })
    );
    expect(await requestStatus(requestId)).toBe("pending");
  });

  it("approves a manual payment with a user-verified assertion", async () => {
    const authenticator = await new TestAuthenticator().register(userId);
    const requestId = await requestPayment();
    const approver = await signInApprover(userId);
    const webauthn = await confirmWithPasskey(
      approver,
      requestId,
      authenticator
    );

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
      webauthn,
    });

    expect(response.status).toBe(200);
    expect(await decisionRecord(requestId)).toEqual(
      expect.objectContaining({ approvalMethod: "user_verification" })
    );
  });

  it("tells a user without a passkey to add one", async () => {
    const requestId = await requestPayment();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(409);
    expect(response.json.error).toBe("passkey_required");
    expect(await requestStatus(requestId)).toBe("pending");
  });

  // R4: the requirement does not live in the best-effort notification.
  it("requires user verification when the notification fails", async () => {
    await new TestAuthenticator().register(userId);
    notificationMock.fail = true;
    const requestId = await requestPayment();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(403);
    expect(response.json.error).toBe("insufficient_user_authentication");
  });

  async function approvePayment(input: {
    agent?: { hostId: string; sessionId: string };
    scope?: string;
  }) {
    const scope = input.scope ?? "openid";
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope,
      login_hint: loginHint,
      authorization_details: JSON.stringify([PAYMENT_RAR]),
      resource: CLIENT_REQUESTED_RESOURCE,
    });
    if (authorize.status !== 200) {
      throw new Error(`bc-authorize answered ${authorize.status}`);
    }
    const authReqId = authorize.json.auth_req_id as string;
    const authReqIdHash = hashCibaAuthReqId(authReqId);

    const approval = await createAuthenticationContext({
      userId,
      loginMethod: "passkey",
      authenticatedAt: new Date(),
      sourceKind: "ciba_approval",
      referenceType: "ciba_request",
    });
    if (input.agent) {
      await db
        .update(cibaRequests)
        .set({
          agentSessionId: input.agent.sessionId,
          hostId: input.agent.hostId,
          assertionVerified: true,
        })
        .where(eq(cibaRequests.authReqId, authReqIdHash));
    }
    await createCibaApproval((body) =>
      auth.api.completeCibaRequest({ body })
    ).approve({
      requestId: await requestIdForAuthReqId(authReqIdHash),
      userId,
      authentication: approval,
      channel: "page",
      grant: { method: "user_verification" },
    });
    return { authReqId, authReqIdHash };
  }

  async function pollToken(authReqId: string) {
    const token = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      client_secret: TEST_CIBA_CLIENT_SECRET,
      auth_req_id: authReqId,
      client_id: CLIENT_ID,
    });
    if (token.status !== 200) {
      throw new Error(
        `token request answered ${token.status}: ${JSON.stringify(token.json)}`
      );
    }
    return token;
  }

  async function issuePaymentToken(): Promise<Record<string, unknown>> {
    const { authReqId } = await approvePayment({});
    return (await pollToken(authReqId)).json;
  }

  it("is issued for the wallet audience whatever resource the client requested", async () => {
    const response = await issuePaymentToken();
    const claims = decodeJwt(response.access_token as string);
    // Upstream adds UserInfo to `aud` for an `openid` token with a resource;
    // ask U9 would let the wallet resource opt out, which flips this.
    expect(claims.aud).toEqual([
      WALLET_AUDIENCE,
      `${getAuthIssuer()}/oauth2/userinfo`,
    ]);
    // The wallet resource sets the lifetime; the payment carries no scope.
    expect(claims.scope).toBe("openid");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(120);
    expect(claims.authorization_details).toEqual([PAYMENT_RAR]);
    // RFC 9396 §7: the token response reports the details the token carries.
    expect(response.authorization_details).toEqual([PAYMENT_RAR]);
  });

  it("keeps the wallet lifetime after a restart with an older resource row", async () => {
    await db
      .update(oauthResources)
      .set({ accessTokenTtl: null })
      .where(eq(oauthResources.identifier, WALLET_AUDIENCE))
      .run();

    vi.resetModules();
    const rebooted = await import("@/lib/auth/auth-config");
    await rebooted.auth.$context;

    const [row] = await db
      .select({ accessTokenTtl: oauthResources.accessTokenTtl })
      .from(oauthResources)
      .where(eq(oauthResources.identifier, WALLET_AUDIENCE))
      .all();
    expect(row?.accessTokenTtl).toBe(120);
  });

  it("lives 120 seconds alongside identity scopes, and UserInfo releases the staged identity", async () => {
    const { authReqId, authReqIdHash } = await approvePayment({
      scope: SPIRITS_SCOPE,
    });
    const identityScopes = ["identity.name", "identity.address"];
    expect(
      await stageFinalCibaDisclosure({
        userId,
        clientId: CLIENT_ID,
        claims: { given_name: "Ada", family_name: "Lovelace" },
        authReqId: authReqIdHash,
        scopes: identityScopes,
        scopeHash: createScopeHash(identityScopes),
        intentJti: crypto.randomUUID(),
      })
    ).toEqual({ ok: true });

    const { json, dpopKeyPair } = await pollToken(authReqId);
    const accessToken = json.access_token as string;
    const claims = decodeJwt(accessToken);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(120);
    expect(claims.ba_sub).toEqual(expect.any(String));
    // R8: a staged release adds only its binding claim; the proof scopes add
    // no anti-abuse handle to a token for an outside audience.
    expect(Object.keys(claims).toSorted()).toEqual(
      [
        "iss",
        "sub",
        "ba_sub",
        "aud",
        "azp",
        "client_id",
        "scope",
        "iat",
        "exp",
        "jti",
        "cnf",
        "reference_id",
        "authorization_details",
        "act",
        RELEASE_BINDING_CLAIM,
      ].toSorted()
    );

    const userInfo = await fetchUserInfo(accessToken, dpopKeyPair);
    expect(userInfo).toEqual({
      status: 200,
      body: expect.objectContaining({
        sub: loginHint,
        given_name: "Ada",
        family_name: "Lovelace",
      }),
    });
  });

  async function issueMcpToken(clientId: string) {
    const { authReqId } = await createTestCibaRequest({
      clientId,
      userId,
      status: "approved",
      resources: JSON.stringify([env.MCP_PUBLIC_URL]),
    });
    const token = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      client_secret: TEST_CIBA_CLIENT_SECRET,
      auth_req_id: authReqId,
      client_id: clientId,
    });
    if (token.status !== 200) {
      throw new Error(`token request answered ${token.status}`);
    }
    return token;
  }

  // R1: a client-keyed subject would let the MCP server and the wallet join
  // what each learns about the user.
  it("gives each audience of one client its own subject", async () => {
    const wallet = await pollToken((await approvePayment({})).authReqId);
    const mcp = await issueMcpToken(CLIENT_ID);
    const walletSub = decodeJwt(wallet.json.access_token as string).sub;
    const mcpSub = decodeJwt(mcp.json.access_token as string).sub;

    expect(decodeJwt(wallet.json.id_token as string).sub).toBe(loginHint);
    expect(new Set([walletSub, mcpSub, loginHint, userId]).size).toBe(4);
    for (const token of [wallet, mcp]) {
      const userInfo = await fetchUserInfo(
        token.json.access_token as string,
        token.dpopKeyPair
      );
      expect(userInfo).toEqual({
        status: 200,
        body: expect.objectContaining({ sub: loginHint }),
      });
    }
  });

  it("gives two clients different subjects at one audience", async () => {
    const otherClientId = "payment-token-other-agent";
    await insertCibaClient(otherClientId, {});

    const first = await issueMcpToken(CLIENT_ID);
    const second = await issueMcpToken(otherClientId);

    expect(decodeJwt(first.json.access_token as string).sub).not.toBe(
      decodeJwt(second.json.access_token as string).sub
    );
  });

  // R2: the wallet token names the agent only by its pairwise act.sub, and
  // what the approval authorizes goes to the client in the token response.
  it("keeps the actor Zentity computed for a verified agent", async () => {
    const agent = await createRegisteredAgent(userId);
    const { authReqId, authReqIdHash } = await approvePayment({ agent });

    const response = (await pollToken(authReqId)).json;
    const claims = decodeJwt(response.access_token as string);
    // R8: the wallet reads aud, jti, exp, cnf, and authorization_details;
    // nothing else beyond the RFC 9068 and provider claims reaches it.
    expect(Object.keys(claims).toSorted()).toEqual(
      [
        "iss",
        "sub",
        "ba_sub",
        "aud",
        "azp",
        "client_id",
        "scope",
        "iat",
        "exp",
        "jti",
        "cnf",
        "reference_id",
        "authorization_details",
        "act",
      ].toSorted()
    );
    // R4: the request hash appears once, as the token's reference_id.
    expect(JSON.stringify(claims).split(authReqIdHash).length - 1).toBe(1);
    expect(JSON.stringify(response)).not.toContain(agent.sessionId);
    expect(JSON.stringify(response)).not.toContain(agent.hostId);
    for (const claim of [
      "task",
      "audit",
      "oversight",
      "capabilities",
      "delegation",
      "aap_claims_version",
    ]) {
      expect(claims).not.toHaveProperty(claim);
    }
    expect(response).toEqual(
      expect.objectContaining({
        capabilities: [{ action: PAYMENT_AUTHORIZATION_CAPABILITY }],
        oversight: {
          method: "user_verification",
          approved_at: expect.any(Number),
        },
        delegation: { depth: 0, max_depth: 1 },
        aap_claims_version: 2,
      })
    );
    expect(claims.sub).toBe(
      await pairwiseValue(`client/${CLIENT_ID} ${WALLET_AUDIENCE}`, userId)
    );
    expect(claims.act).toEqual({
      sub: await pairwiseValue(
        `client/${CLIENT_ID} ${WALLET_AUDIENCE}`,
        agent.sessionId
      ),
      sub_profile: "service",
    });
  });

  it("stores the scope the client sent", async () => {
    await approvePayment({ scope: "openid proof:age" });

    const [request] = await db
      .select({ scope: cibaRequests.scope })
      .from(cibaRequests)
      .all();
    expect(request?.scope).toBe("openid proof:age");
  });

  it("refuses the wallet audience without a payment entry", async () => {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: loginHint,
      resource: WALLET_AUDIENCE,
    });

    expect(authorize).toEqual({
      status: 400,
      json: {
        error: "invalid_target",
        error_description: "the wallet audience accepts only payment requests",
      },
    });
    expect(await db.select().from(cibaRequests).all()).toHaveLength(0);
  });

  it("refuses a payment from a client that did not register the type", async () => {
    const clientId = "payment-undeclared-agent";
    await insertCibaClient(clientId, {});

    const authorize = await postBcAuthorize({
      client_id: clientId,
      scope: "openid",
      login_hint: (await resolveSubForClientId(userId, clientId)) as string,
      authorization_details: JSON.stringify([PAYMENT_RAR]),
    });

    expect(authorize.status).toBe(400);
    expect(authorize.json.error).toBe("invalid_authorization_details");
    expect(await db.select().from(cibaRequests).all()).toHaveLength(0);
  });

  // RFC 9396 §5: a known type with unknown, invalid, or missing fields.
  it.each([
    ["an unknown member", [{ ...PAYMENT_RAR, memo: "extra" }]],
    [
      "a wrong type",
      [{ ...PAYMENT_RAR, amount: { ...PAYMENT_RAR.amount, value: 50 } }],
    ],
    [
      "a missing field",
      [
        Object.fromEntries(
          Object.entries(PAYMENT_RAR).filter(([k]) => k !== "recipient")
        ),
      ],
    ],
    [
      "two payment entries",
      [PAYMENT_RAR, { ...PAYMENT_RAR, payment_id: "pay_456" }],
    ],
  ])("refuses a payment with %s", async (_case, details) => {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: loginHint,
      authorization_details: JSON.stringify(details),
    });

    expect(authorize.status).toBe(400);
    expect(authorize.json.error).toBe("invalid_authorization_details");
    expect(await db.select().from(cibaRequests).all()).toHaveLength(0);
  });

  it.each([
    ["is not JSON", "not-json"],
    ["has an unregistered type", JSON.stringify([{ type: "subscription" }])],
    [
      "carries the pre-T2 purchase shape",
      JSON.stringify([
        {
          type: "purchase",
          url: "https://merchant.example",
          minComplianceLevel: 2,
          merchant: "Corner Books",
        },
      ]),
    ],
  ])("rejects authorization_details that %s", async (_case, details) => {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: loginHint,
      authorization_details: details,
    });

    expect(authorize.status).toBe(400);
    expect(authorize.json.error).toBe("invalid_authorization_details");
  });

  it("fails closed when WALLET_AUDIENCE is unset", async () => {
    mockEnv.walletAudience = undefined;

    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: loginHint,
      authorization_details: JSON.stringify([PAYMENT_RAR]),
    });

    expect(authorize.status).toBe(500);
    expect(authorize.json.error).toBe("server_error");
    expect(await db.select().from(cibaRequests).all()).toHaveLength(0);
  });

  it("reaches the wallet's revocation feed when its client revokes it", async () => {
    const token = (await issuePaymentToken()).access_token as string;

    const revocation = await auth.handler(
      new Request(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token,
          client_id: CLIENT_ID,
          client_secret: TEST_CIBA_CLIENT_SECRET,
        }),
      })
    );
    expect(revocation.status).toBe(200);

    const feed = await listRevocations(
      new Request("http://localhost:3000/api/auth/oauth2/revoked?since=0", {
        headers: env.INTERNAL_SERVICE_TOKEN
          ? { authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}` }
          : {},
      })
    );
    expect(feed.status).toBe(200);
    expect(
      ((await feed.json()) as { revocations: { jti: string }[] }).revocations
    ).toEqual([expect.objectContaining({ jti: decodeJwt(token).jti })]);
  });
});

describe("wallet audience outside a CIBA payment", () => {
  const WALLET_TARGET = {
    error: "invalid_target",
    error_description: "the wallet audience accepts only payment requests",
  };

  beforeEach(async () => {
    await resetDatabase();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        name: "Wallet Target Client",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify([
          "authorization_code",
          "refresh_token",
          "client_credentials",
        ]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
      })
      .run();
  });

  const authorizeQuery = {
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: "http://localhost/callback",
    scope: "openid",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: WALLET_AUDIENCE,
  };

  it("is refused at the authorization endpoint", async () => {
    const response = await auth.handler(
      new Request(
        `${AUTH_URL}/oauth2/authorize?${new URLSearchParams(authorizeQuery)}`
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(WALLET_TARGET);
  });

  it("is refused beside another resource in a form-encoded authorization request", async () => {
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oauth2/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams([
          ...Object.entries(authorizeQuery),
          ["resource", env.MCP_PUBLIC_URL],
        ]),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(WALLET_TARGET);
  });

  it("is refused at the pushed authorization request endpoint", async () => {
    expect(await postForm(`${AUTH_URL}/oauth2/par`, authorizeQuery)).toEqual({
      status: 400,
      json: WALLET_TARGET,
    });
  });

  it("is refused at the authorization challenge endpoint", async () => {
    expect(
      await postForm(`${AUTH_URL}/oauth2/authorize-challenge`, {
        client_id: CLIENT_ID,
        scope: "openid",
        resource: WALLET_AUDIENCE,
      })
    ).toEqual({ status: 400, json: WALLET_TARGET });
  });

  it.each([
    ["client_credentials", { grant_type: "client_credentials" }],
    [
      "pre-authorized code",
      {
        grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "pre-authorized_code": "unused",
      },
    ],
    ["refresh", { grant_type: "refresh_token", refresh_token: "unused" }],
  ])("is refused by the %s grant", async (_grant, body) => {
    const { status, json } = await postTokenWithDpop({
      client_id: CLIENT_ID,
      resource: WALLET_AUDIENCE,
      ...body,
    });

    expect({ status, json }).toEqual({ status: 400, json: WALLET_TARGET });
  });

  it("is refused as a token exchange audience", async () => {
    const { status, json } = await postTokenWithDpop({
      client_id: CLIENT_ID,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "unused",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: WALLET_AUDIENCE,
    });

    expect({ status, json }).toEqual({ status: 400, json: WALLET_TARGET });
  });
});
