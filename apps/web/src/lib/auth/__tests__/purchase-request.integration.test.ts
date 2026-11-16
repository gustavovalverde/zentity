import crypto from "node:crypto";

import { signAgentAssertion, type TaskHashInput } from "@zentity/sdk";
import { AGENT_SESSION_INACTIVE_DESCRIPTION } from "@zentity/sdk/agent-contract";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.hoisted(() => ({ sent: 0 }));
const identity = vi.hoisted(() => ({
  strength: "documentary_full",
  validity: "verified",
}));
vi.mock("@/lib/identity/verification/read-model", async (importOriginal) => {
  const mod =
    await importOriginal<
      typeof import("@/lib/identity/verification/read-model")
    >();
  return {
    ...mod,
    getVerificationReadModel: async (userId: string) => {
      const model = await mod.getVerificationReadModel(userId);
      return {
        ...model,
        bundle: { ...model.bundle, validityStatus: identity.validity },
        compliance: {
          ...model.compliance,
          identity: {
            ...model.compliance.identity,
            strength: identity.strength,
          },
        },
      };
    },
  };
});
vi.mock("@/lib/agents/push-sender", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agents/push-sender")>();
  return {
    ...mod,
    sendWebPush: (...args: Parameters<typeof mod.sendWebPush>) => {
      pushMock.sent += 1;
      return mod.sendWebPush(...args);
    },
  };
});

import { auth } from "@/lib/auth/auth-config";
import { resolveSubForClientId } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  confirmWithPasskey,
  postDecision,
  requestStatus,
  signInApprover,
} from "@/test-utils/ciba-decision-test-utils";
import {
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
const CLIENT_ID = "purchase-agent";
const PAYMENT_CLIENT_ID = "payment-only-agent";

const PURCHASE = {
  type: "purchase",
  merchant: { name: "Corner Books" },
  item: "A paperback",
  amount: { value: "12.00", currency: "EUR" },
};

const REQUIREMENT = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "1",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x000000000000000000000000000000000000dEaD",
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};

const X402_PURCHASE = {
  type: "x402_purchase",
  resource_url:
    "https://merchant.example/api/x402/access?resourceId=verified-identity",
  resource_description: "Financial analytics",
  payment_requirements: REQUIREMENT,
  min_identity_strength: "documentary_full",
};

const DIRECT_SCOPE = "openid identity.name identity.address";
const X402_SCOPE = "openid poh";

async function insertCibaClient(
  clientId: string,
  metadata: Record<string, unknown> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Shopping Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      subjectType: "pairwise",
      sectorIdentifier: `client/${clientId}`,
      metadata: JSON.stringify({
        backchannel_token_delivery_mode: "poll",
        ...metadata,
      }),
    })
    .run();
}

async function postBcAuthorize(
  body: Record<string, string>,
  headers: Record<string, string> = {}
) {
  const response = await auth.handler(
    new Request(BC_AUTHORIZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  return {
    status: response.status,
    json: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

async function createRegisteredAgent(userId: string, clientId: string) {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const [host] = await db
    .insert(agentHosts)
    .values({
      userId,
      clientId,
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
      publicKey: JSON.stringify(await exportJWK(publicKey)),
      publicKeyThumbprint: `agent-${crypto.randomUUID()}`,
      displayName: "Shopping Agent",
    })
    .returning({ id: agentSessions.id });
  return {
    hostId: host?.id as string,
    sessionId: session?.id as string,
    sessionPrivateKey: await exportJWK(privateKey),
  };
}

describe("purchase requests at bc-authorize", () => {
  let userId: string;
  let loginHint: string;

  function request(
    details: unknown,
    scope: string,
    extra: Record<string, string> = {}
  ) {
    return postBcAuthorize({
      client_id: CLIENT_ID,
      scope,
      login_hint: loginHint,
      binding_message: "Buy from Corner Books",
      authorization_details:
        typeof details === "string" ? details : JSON.stringify(details),
      ...extra,
    });
  }

  async function storedRequests() {
    return await db
      .select({
        scope: cibaRequests.scope,
        authorizationDetails: cibaRequests.authorizationDetails,
        resources: cibaRequests.resources,
      })
      .from(cibaRequests)
      .all();
  }

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await insertCibaClient(CLIENT_ID);
    loginHint = (await resolveSubForClientId(userId, CLIENT_ID)) as string;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    pushMock.sent = 0;
    identity.strength = "documentary_full";
  });

  async function storedAgentBinding() {
    return await db
      .select({
        assertionVerified: cibaRequests.assertionVerified,
        scope: cibaRequests.scope,
      })
      .from(cibaRequests)
      .get();
  }

  // R29: the pins change only representation, so the hash the server
  // recomputes from the stored request is the hash the agent signed.
  it.each([
    ["purchase", PURCHASE, "identity.address openid identity.name"],
    ["x402_purchase", X402_PURCHASE, "poh openid"],
  ])(
    "binds an Agent-Assertion over a %s request",
    async (_type, detail, scope) => {
      const agent = await createRegisteredAgent(userId, CLIENT_ID);
      const reordered = Object.fromEntries(Object.entries(detail).reverse());
      const body = {
        client_id: CLIENT_ID,
        scope,
        login_hint: loginHint,
        binding_message: "Buy from Corner Books",
        authorization_details: JSON.stringify([reordered]),
      };
      const assertion = await signAgentAssertion({
        bindingMessage: body.binding_message,
        scope: body.scope,
        authorizationDetails: body.authorization_details,
        ...agent,
      });

      const response = await postBcAuthorize(body, {
        "Agent-Assertion": assertion,
      });

      expect(response.status).toBe(200);
      expect(await storedAgentBinding()).toEqual({
        assertionVerified: true,
        scope,
      });
    }
  );

  // R28: a mismatched assertion is refused, not silently left unbound.
  it.each([
    [
      "the binding message alone",
      (request: TaskHashInput): TaskHashInput => ({
        bindingMessage: request.bindingMessage,
        scope: "openid",
      }),
    ],
    [
      "another amount",
      (request: TaskHashInput): TaskHashInput => ({
        ...request,
        authorizationDetails: JSON.stringify([
          { ...PURCHASE, amount: { value: "1.00", currency: "EUR" } },
        ]),
      }),
    ],
  ])("refuses an Agent-Assertion signed over %s", async (_case, change) => {
    const agent = await createRegisteredAgent(userId, CLIENT_ID);
    const body = {
      client_id: CLIENT_ID,
      scope: DIRECT_SCOPE,
      login_hint: loginHint,
      binding_message: "Buy from Corner Books",
      authorization_details: JSON.stringify([PURCHASE]),
    };
    const signed = change({
      bindingMessage: body.binding_message,
      scope: body.scope,
      authorizationDetails: body.authorization_details,
    });
    const assertion = await signAgentAssertion({ ...signed, ...agent });

    const response = await postBcAuthorize(body, {
      "Agent-Assertion": assertion,
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: "invalid_request",
      error_description: "Agent-Assertion does not match this request",
    });
    expect(await storedRequests()).toHaveLength(0);
    expect(pushMock.sent).toBe(0);
  });

  async function signedPurchaseRequest(
    agent: Awaited<ReturnType<typeof createRegisteredAgent>>
  ) {
    const body = {
      client_id: CLIENT_ID,
      scope: DIRECT_SCOPE,
      login_hint: loginHint,
      binding_message: "Buy from Corner Books",
      authorization_details: JSON.stringify([PURCHASE]),
    };
    const assertion = await signAgentAssertion({
      bindingMessage: body.binding_message,
      scope: body.scope,
      authorizationDetails: body.authorization_details,
      ...agent,
    });
    return postBcAuthorize(body, { "Agent-Assertion": assertion });
  }

  // A runtime tells an inactive session from a mismatched request, registers
  // a new session, and signs again.
  it.each([
    [
      "an unknown session",
      (agent: { sessionId: string }) => {
        agent.sessionId = "unknown-session";
      },
    ],
    [
      "a session idle past its TTL",
      async (agent: { sessionId: string }) => {
        await db
          .update(agentSessions)
          .set({ lastActiveAt: new Date(Date.now() - 31 * 60 * 1000) })
          .where(eq(agentSessions.id, agent.sessionId))
          .run();
      },
    ],
    [
      "a revoked session",
      async (agent: { sessionId: string }) => {
        await db
          .update(agentSessions)
          .set({ status: "revoked" })
          .where(eq(agentSessions.id, agent.sessionId))
          .run();
      },
    ],
  ])(
    "refuses an Agent-Assertion from %s until the runtime registers a new one",
    async (_case, lapse) => {
      const agent = await createRegisteredAgent(userId, CLIENT_ID);
      await lapse(agent);

      const refused = await signedPurchaseRequest(agent);

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual({
        error: "invalid_request",
        error_description: AGENT_SESSION_INACTIVE_DESCRIPTION,
      });
      expect(await storedRequests()).toHaveLength(0);

      const renewed = await signedPurchaseRequest(
        await createRegisteredAgent(userId, CLIENT_ID)
      );

      expect(renewed.status).toBe(200);
      expect(await storedAgentBinding()).toEqual({
        assertionVerified: true,
        scope: DIRECT_SCOPE,
      });
    }
  );

  // R1: both purchase types are registered.
  it.each([
    ["purchase", PURCHASE, DIRECT_SCOPE],
    ["x402_purchase", X402_PURCHASE, X402_SCOPE],
  ])("accepts a %s request", async (_type, detail, scope) => {
    const response = await request([detail], scope);

    expect(response.status).toBe(200);
    // R2: the stored entry is the canonical input; R29: the scope is the
    // scope that was sent; the app-origin resource leaves an opaque token.
    const [stored] = await storedRequests();
    expect(stored?.scope).toBe(scope);
    expect(JSON.parse(stored?.authorizationDetails as string)).toEqual([
      detail,
    ]);
    expect(stored?.resources).toBeNull();
  });

  it("re-serializes the entry and pins the resource to Zentity", async () => {
    const reordered = Object.fromEntries(Object.entries(PURCHASE).reverse());
    const response = await request(
      ` ${JSON.stringify([reordered])} `,
      DIRECT_SCOPE,
      { resource: "https://merchant.example" }
    );

    expect(response.status).toBe(200);
    const [stored] = await storedRequests();
    expect(JSON.parse(stored?.authorizationDetails as string)).toEqual([
      PURCHASE,
    ]);
    expect(stored?.resources).toBeNull();
  });

  // R1 and R2: the shape the MCP server sent before purchases were
  // registered, and unknown members of either type.
  it.each([
    [
      "the pre-T2 purchase shape",
      [
        {
          type: "purchase",
          url: "https://merchant.example",
          minComplianceLevel: 2,
          merchant: "Corner Books",
        },
      ],
      DIRECT_SCOPE,
    ],
    ["an unknown purchase member", [{ ...PURCHASE, note: "x" }], DIRECT_SCOPE],
    [
      "an unknown x402_purchase member",
      [{ ...X402_PURCHASE, amount: { value: "1", currency: "USD" } }],
      X402_SCOPE,
    ],
    [
      "an unknown extra member",
      [
        {
          ...X402_PURCHASE,
          payment_requirements: {
            ...REQUIREMENT,
            extra: { ...REQUIREMENT.extra, feePayer: "x" },
          },
        },
      ],
      X402_SCOPE,
    ],
    [
      "two purchase entries",
      [PURCHASE, { ...PURCHASE, item: "Another paperback" }],
      DIRECT_SCOPE,
    ],
    [
      "a purchase beside an x402_purchase",
      [PURCHASE, X402_PURCHASE],
      X402_SCOPE,
    ],
    // R23: RFC 9396 `locations` would survive into the token.
    [
      "locations",
      [{ ...PURCHASE, locations: ["https://merchant.example"] }],
      DIRECT_SCOPE,
    ],
    [
      "an unregistered asset",
      [
        {
          ...X402_PURCHASE,
          payment_requirements: {
            ...REQUIREMENT,
            network: "eip155:8453",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
        },
      ],
      X402_SCOPE,
    ],
    [
      "an http resource outside loopback",
      [{ ...X402_PURCHASE, resource_url: "http://merchant.example/x" }],
      X402_SCOPE,
    ],
  ])("refuses %s", async (_case, details, scope) => {
    const response = await request(details, scope);

    expect(response.status).toBe(400);
    expect(response.json.error).toBe("invalid_authorization_details");
    expect(await storedRequests()).toHaveLength(0);
  });

  // R19 and R34: scopes never mix with the wrong purchase type.
  it.each([
    ["purchase with poh", [PURCHASE], "openid poh identity.name"],
    [
      "x402_purchase with identity.name",
      [X402_PURCHASE],
      "openid poh identity.name",
    ],
    ["x402_purchase without poh", [X402_PURCHASE], "openid"],
  ])("refuses %s", async (_case, details, scope) => {
    const response = await request(details, scope);

    expect(response.status).toBe(400);
    expect(response.json.error).toBe("invalid_scope");
    expect(await storedRequests()).toHaveLength(0);
  });

  it("refuses poh without an x402_purchase entry", async () => {
    const response = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: X402_SCOPE,
      login_hint: loginHint,
      binding_message: "Prove you are human",
    });

    expect(response.status).toBe(400);
    expect(response.json.error).toBe("invalid_scope");
  });

  // R36: loopback merchants serve local development only.
  it("accepts a loopback http resource outside production", async () => {
    const response = await request(
      [
        {
          ...X402_PURCHASE,
          resource_url: "http://localhost:3102/api/x402/access?resourceId=a",
        },
      ],
      X402_SCOPE
    );

    expect(response.status).toBe(200);
  });

  it("refuses a loopback http resource in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await request(
      [
        {
          ...X402_PURCHASE,
          resource_url: "http://localhost:3102/api/x402/access?resourceId=a",
        },
      ],
      X402_SCOPE
    );

    expect(response.status).toBe(400);
    expect(response.json.error).toBe("invalid_authorization_details");
  });

  // RFC 9396 §10: a client that registered types requests only those.
  it("refuses a purchase from a client that registered only payments", async () => {
    await insertCibaClient(PAYMENT_CLIENT_ID, {
      authorization_details_types: ["payment_authorization"],
    });
    const response = await postBcAuthorize({
      client_id: PAYMENT_CLIENT_ID,
      scope: DIRECT_SCOPE,
      login_hint: (await resolveSubForClientId(
        userId,
        PAYMENT_CLIENT_ID
      )) as string,
      binding_message: "Buy from Corner Books",
      authorization_details: JSON.stringify([PURCHASE]),
    });

    expect(response.status).toBe(400);
    expect(response.json.error).toBe("invalid_authorization_details");
    expect(
      await db
        .select()
        .from(cibaRequests)
        .where(eq(cibaRequests.clientId, PAYMENT_CLIENT_ID))
        .all()
    ).toHaveLength(0);
  });
});

describe("deciding a purchase request", () => {
  let userId: string;
  let loginHint: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await insertCibaClient(CLIENT_ID);
    loginHint = (await resolveSubForClientId(userId, CLIENT_ID)) as string;
  });

  afterEach(() => {
    identity.strength = "documentary_full";
    identity.validity = "verified";
  });

  async function requestX402Purchase(): Promise<string> {
    const response = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: X402_SCOPE,
      login_hint: loginHint,
      binding_message: "Proof-of-Human for merchant.example",
      authorization_details: JSON.stringify([X402_PURCHASE]),
    });
    if (response.status !== 200) {
      throw new Error(`bc-authorize answered ${response.status}`);
    }
    const row = await db
      .select({ id: cibaRequests.id })
      .from(cibaRequests)
      .where(
        eq(
          cibaRequests.authReqId,
          hashCibaAuthReqId(response.json.auth_req_id as string)
        )
      )
      .get();
    return row?.id as string;
  }

  async function readRequestDetails(
    approver: Awaited<ReturnType<typeof signInApprover>>,
    requestId: string
  ) {
    const response = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/ciba/request?request_id=${requestId}`,
        { headers: { cookie: approver.cookie } }
      )
    );
    return (await response.json()) as Record<string, unknown>;
  }

  // R24: purchases need a user-verified passkey assertion.
  it("refuses a manual x402 approval without a passkey assertion", async () => {
    await new TestAuthenticator().register(userId);
    const requestId = await requestX402Purchase();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(403);
    expect(response.json.error).toBe("insufficient_user_authentication");
    expect(await requestStatus(requestId)).toBe("pending");
  });

  it("tells a user without a passkey to add one", async () => {
    const requestId = await requestX402Purchase();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(409);
    expect(response.json.error).toBe("passkey_required");
  });

  it("refuses an approval from a notification", async () => {
    await new TestAuthenticator().register(userId);
    const requestId = await requestX402Purchase();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "push",
    });

    expect(response.status).toBe(403);
    expect(response.json.error).toBe("review_required");
  });

  it("approves with a user-verified assertion at the required strength", async () => {
    const authenticator = await new TestAuthenticator().register(userId);
    const requestId = await requestX402Purchase();
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
    expect(
      (await readRequestDetails(approver, requestId)).identity_strength
    ).toEqual({ required: "documentary_full", satisfied: true });
  });

  // R14: the server, not only the agent, enforces the merchant's minimum.
  it("refuses an approval below the merchant's identity strength", async () => {
    identity.strength = "documentary";
    const authenticator = await new TestAuthenticator().register(userId);
    const requestId = await requestX402Purchase();
    const approver = await signInApprover(userId);

    expect(await readRequestDetails(approver, requestId)).toEqual(
      expect.objectContaining({
        identity_strength: { required: "documentary_full", satisfied: false },
      })
    );

    // Checked before the passkey challenge is spent.
    const withoutAssertion = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });
    expect(withoutAssertion.status).toBe(403);
    expect(withoutAssertion.json.error).toBe("insufficient_identity_strength");

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

    expect(response.status).toBe(403);
    expect(response.json.error).toBe("insufficient_identity_strength");
    expect(await requestStatus(requestId)).toBe("pending");
  });

  it("refuses an approval while the identity's validity is stale", async () => {
    identity.validity = "stale";
    const authenticator = await new TestAuthenticator().register(userId);
    const requestId = await requestX402Purchase();
    const approver = await signInApprover(userId);

    expect(await readRequestDetails(approver, requestId)).toEqual(
      expect.objectContaining({
        identity_strength: { required: "documentary_full", satisfied: false },
      })
    );

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

    expect(response.status).toBe(403);
    expect(response.json.error).toBe("insufficient_identity_strength");
    expect(await requestStatus(requestId)).toBe("pending");
  });

  it("lets the user deny a request below the merchant's identity strength", async () => {
    identity.strength = "none";
    const requestId = await requestX402Purchase();
    const approver = await signInApprover(userId);

    const response = await postDecision(approver, {
      request_id: requestId,
      decision: "denied",
      channel: "page",
    });

    expect(response.status).toBe(200);
    expect(await requestStatus(requestId)).toBe("denied");
  });
});
