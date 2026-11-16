import crypto from "node:crypto";

import { signAgentAssertion } from "@zentity/sdk";
import { eq } from "drizzle-orm";
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { POST as mintRoute } from "@/app/api/auth/oauth2/proof-of-human/route";
import { auth } from "@/lib/auth/auth-config";
import {
  pairwiseValue,
  resolveSubForClientId,
  tokenSector,
} from "@/lib/auth/oidc/pairwise";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaApprovals, cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  confirmWithPasskey,
  postDecision,
  signInApprover,
} from "@/test-utils/ciba-decision-test-utils";
import {
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  createAuthHandlerDpopClient,
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
const POH_URL = "http://localhost:3000/api/auth/oauth2/proof-of-human";
const AGENT_CLIENT = "poh-agent";
const OTHER_AGENT_CLIENT = "poh-other-agent";
const PUBLIC_AGENT_CLIENT = "poh-public-agent";
const MERCHANT = "https://merchant.example";
const OTHER_MERCHANT = "https://shop.example";
const BASE64URL_JTI = /^[A-Za-z0-9_-]{22}$/;

function x402Purchase(
  merchant: string,
  overrides: { maxTimeoutSeconds?: number; minIdentityStrength?: string } = {}
) {
  return {
    type: "x402_purchase",
    resource_url: `${merchant}/api/x402/access?resourceId=verified-identity`,
    resource_description: "Financial analytics for Jane Doe",
    payment_requirements: {
      scheme: "exact",
      network: "eip155:84532",
      amount: "1",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: overrides.maxTimeoutSeconds ?? 300,
      extra: { name: "USDC", version: "2" },
    },
    min_identity_strength: overrides.minIdentityStrength ?? "documentary_full",
  };
}

async function insertCibaClient(
  clientId: string,
  values: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "Shopping Agent",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE, TOKEN_EXCHANGE_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      subjectType: "pairwise",
      sectorIdentifier: `client/${clientId}`,
      metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
      ...values,
    })
    .run();
}

async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {}
) {
  const response = await auth.handler(
    new Request(url, {
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

type RegisteredAgent = Awaited<ReturnType<typeof createRegisteredAgent>>;

/** Calls the mint route with the agent's per-purchase key. */
async function mint(keyPair: DpopKeyPair, accessToken: string) {
  const client = await createAuthHandlerDpopClient(keyPair);
  const response = await client.fetch(POH_URL, {
    method: "POST",
    accessToken,
    fetch: (url, init) => mintRoute(new Request(url, init)),
  });
  return {
    status: response.status,
    headers: response.headers,
    json: (await response.json()) as Record<string, unknown>,
  };
}

describe("Proof-of-Human mint", () => {
  let userId: string;
  let authenticator: TestAuthenticator;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    authenticator = await new TestAuthenticator().register(userId);
    await insertCibaClient(AGENT_CLIENT);
  });

  afterEach(() => {
    identity.strength = "documentary_full";
    identity.validity = "verified";
  });

  /**
   * Runs one x402 approval end to end: bc-authorize, the user's passkey
   * approval on the page, and the CIBA token poll with the per-purchase key.
   */
  async function approveX402(input: {
    agent?: RegisteredAgent;
    clientId?: string;
    detail?: ReturnType<typeof x402Purchase>;
    keyPair?: DpopKeyPair;
  }) {
    const clientId = input.clientId ?? AGENT_CLIENT;
    const detail = input.detail ?? x402Purchase(MERCHANT);
    const loginHint = (await resolveSubForClientId(userId, clientId)) as string;
    const body = {
      client_id: clientId,
      scope: "openid poh",
      login_hint: loginHint,
      binding_message: "Proof-of-Human for merchant.example",
      authorization_details: JSON.stringify([detail]),
    };
    const assertion = input.agent
      ? await signAgentAssertion({
          bindingMessage: body.binding_message,
          scope: body.scope,
          authorizationDetails: body.authorization_details,
          ...input.agent,
        })
      : undefined;
    const authorize = await postForm(
      BC_AUTHORIZE_URL,
      body,
      assertion ? { "Agent-Assertion": assertion } : {}
    );
    if (authorize.status !== 200) {
      throw new Error(`bc-authorize: ${JSON.stringify(authorize.json)}`);
    }
    const authReqId = authorize.json.auth_req_id as string;
    const request = await db
      .select({ id: cibaRequests.id })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
      .get();
    const approver = await signInApprover(userId);
    const webauthn = await confirmWithPasskey(
      approver,
      request?.id as string,
      authenticator
    );
    const decision = await postDecision(approver, {
      request_id: request?.id as string,
      channel: "page",
      webauthn,
    });
    if (decision.status !== 200) {
      throw new Error(`decision: ${JSON.stringify(decision.json)}`);
    }

    const keyPair = input.keyPair ?? (await createTestDpopKeyPair());
    const token = await postTokenWithDpop(
      {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: clientId,
      },
      keyPair
    );
    if (token.status !== 200) {
      throw new Error(`token: ${JSON.stringify(token.json)}`);
    }
    return {
      accessToken: token.json.access_token as string,
      authReqIdHash: hashCibaAuthReqId(authReqId),
      keyPair,
      tokenResponse: token.json,
    };
  }

  async function mintFor(input: Parameters<typeof approveX402>[0]) {
    const approval = await approveX402(input);
    const minted = await mint(approval.keyPair, approval.accessToken);
    if (minted.status !== 200) {
      throw new Error(`mint: ${JSON.stringify(minted.json)}`);
    }
    return {
      ...approval,
      token: minted.json.token as string,
      claims: decodeJwt(minted.json.token as string),
    };
  }

  // R9: an audienced, short-lived, single-use, typed token.
  it("mints one merchant-audienced token per approval", async () => {
    const approval = await approveX402({});
    // The CIBA token response returns the approved entry unchanged.
    expect(approval.tokenResponse.authorization_details).toEqual([
      x402Purchase(MERCHANT),
    ]);

    const minted = await mint(approval.keyPair, approval.accessToken);

    expect(minted.status).toBe(200);
    expect(minted.headers.get("Cache-Control")).toBe("no-store");
    expect(minted.headers.get("DPoP-Nonce")).toBeTruthy();
    expect(minted.json.token_type).toBe("DPoP");
    const token = minted.json.token as string;
    expect(decodeProtectedHeader(token)).toEqual(
      expect.objectContaining({ alg: "EdDSA", typ: "poh+jwt" })
    );
    const claims = decodeJwt(token);
    expect(claims.aud).toBe(MERCHANT);
    expect(claims.iss).toBe("http://localhost:3000");
    expect(claims.jti).toEqual(expect.stringMatching(BASE64URL_JTI));
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(
      300
    );
    expect(minted.json.expires_in).toBe(
      (claims.exp as number) - (claims.iat as number)
    );
    expect(claims.scope).toBe("poh");
    expect(claims.cnf).toEqual({
      jkt: await calculateJwkThumbprint(approval.keyPair.jwk, "sha256"),
    });
    expect(claims.poh).toEqual({
      identity: { strength_at_least: "documentary_full" },
      policy: { version: expect.any(String) },
    });

    const record = await db
      .select({
        pohJti: cibaApprovals.pohJti,
        pohMintedAt: cibaApprovals.pohMintedAt,
      })
      .from(cibaApprovals)
      .where(eq(cibaApprovals.referenceId, approval.authReqIdHash))
      .get();
    expect(record?.pohJti).toBe(claims.jti);
    expect(record?.pohMintedAt).toBeInstanceOf(Date);

    const second = await mint(approval.keyPair, approval.accessToken);
    expect(second.status).toBe(401);
    expect(second.json).toEqual(
      expect.objectContaining({
        error: "invalid_token",
        error_description: "This approval is no longer usable",
      })
    );
  });

  it("yields exactly one token from ten concurrent mints", async () => {
    const approval = await approveX402({});

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        mint(approval.keyPair, approval.accessToken)
      )
    );

    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 401)).toHaveLength(9);
  });

  it("lives no longer than the merchant's payment timeout", async () => {
    const { claims } = await mintFor({
      detail: x402Purchase(MERCHANT, { maxTimeoutSeconds: 60 }),
    });

    expect((claims.exp as number) - (claims.iat as number)).toBe(60);
  });

  // R21: the token states the predicate the merchant needs, nothing more.
  it("carries no item, description, identity flags, humanity, or client", async () => {
    const { claims } = await mintFor({});
    const serialized = JSON.stringify(claims);

    expect(claims).not.toHaveProperty("client_id");
    expect(claims).not.toHaveProperty("azp");
    expect(claims).not.toHaveProperty("ba_sub");
    expect(claims).not.toHaveProperty("item");
    expect(claims.poh).not.toHaveProperty("humanity");
    expect(claims.poh).not.toHaveProperty("identity.verified");
    expect((claims.poh as { identity: object }).identity).not.toHaveProperty(
      "verified"
    );
    expect(serialized).not.toContain("resource_description");
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain(AGENT_CLIENT);
    const { resource_description: _shown, ...approved } =
      x402Purchase(MERCHANT);
    expect(claims.authorization_details).toEqual([approved]);
  });

  // R10: the subject is pairwise per client and merchant.
  it("names the user by a subject pairwise per client and merchant", async () => {
    await insertCibaClient(OTHER_AGENT_CLIENT);
    // A client registered at the merchant's own host.
    await insertCibaClient("merchant-site-client", {
      redirectUris: JSON.stringify([`${MERCHANT}/callback`]),
      sectorIdentifier: new URL(MERCHANT).host,
    });

    const first = await mintFor({});
    const again = await mintFor({});
    const otherMerchant = await mintFor({
      detail: x402Purchase(OTHER_MERCHANT),
    });
    const otherClient = await mintFor({ clientId: OTHER_AGENT_CLIENT });

    expect(again.claims.sub).toBe(first.claims.sub);
    expect(otherMerchant.claims.sub).not.toBe(first.claims.sub);
    expect(otherClient.claims.sub).not.toBe(first.claims.sub);
    expect(first.claims.sub).toBe(
      await pairwiseValue(
        tokenSector(
          { redirectUris: [], sectorIdentifier: `client/${AGENT_CLIENT}` },
          MERCHANT
        ),
        userId
      )
    );
    for (const clientId of [
      AGENT_CLIENT,
      OTHER_AGENT_CLIENT,
      "merchant-site-client",
    ]) {
      const clientSubject = await resolveSubForClientId(userId, clientId);
      for (const minted of [first, otherMerchant, otherClient]) {
        expect(minted.claims.sub).not.toBe(clientSubject);
      }
    }
    expect(first.claims.sub).not.toBe(userId);
  });

  it("names the user pairwise even for a client with a public subject type", async () => {
    await insertCibaClient(PUBLIC_AGENT_CLIENT, { subjectType: "public" });

    const { claims } = await mintFor({ clientId: PUBLIC_AGENT_CLIENT });

    expect(claims.sub).not.toBe(userId);
    expect(claims.sub).toBe(
      await pairwiseValue(
        tokenSector(
          {
            redirectUris: [],
            sectorIdentifier: `client/${PUBLIC_AGENT_CLIENT}`,
          },
          MERCHANT
        ),
        userId
      )
    );
  });

  // R11: a fresh key per purchase, and a per-merchant agent subject.
  it("binds each purchase to its own key and names the agent per merchant", async () => {
    const agent = await createRegisteredAgent(userId, AGENT_CLIENT);

    const atMerchant = await mintFor({ agent });
    const atOtherMerchant = await mintFor({
      agent,
      detail: x402Purchase(OTHER_MERCHANT),
    });

    const jkt = (claims: Record<string, unknown>) =>
      (claims.cnf as { jkt: string }).jkt;
    expect(jkt(atMerchant.claims)).toBe(
      await calculateJwkThumbprint(atMerchant.keyPair.jwk, "sha256")
    );
    expect(jkt(atOtherMerchant.claims)).not.toBe(jkt(atMerchant.claims));
    expect(atMerchant.claims.act).toEqual({
      sub: await pairwiseValue(
        tokenSector(
          { redirectUris: [], sectorIdentifier: `client/${AGENT_CLIENT}` },
          MERCHANT
        ),
        agent.sessionId
      ),
      sub_profile: "service",
    });
    expect((atOtherMerchant.claims.act as { sub: string }).sub).not.toBe(
      (atMerchant.claims.act as { sub: string }).sub
    );
    expect(JSON.stringify(atMerchant.claims)).not.toContain(agent.sessionId);
    expect(JSON.stringify(atMerchant.claims)).not.toContain(agent.hostId);
  });

  // R14: strength is checked again at the mint.
  it("refuses the mint when identity strength drops after approval", async () => {
    const approval = await approveX402({});
    identity.strength = "documentary";

    const refused = await mint(approval.keyPair, approval.accessToken);

    expect(refused.status).toBe(401);
    expect(refused.json.error).toBe("invalid_token");
    // The refusal leaves the approval unspent.
    identity.strength = "documentary_full";
    expect((await mint(approval.keyPair, approval.accessToken)).status).toBe(
      200
    );
  });

  it("refuses the mint when the identity's validity lapses after approval", async () => {
    const approval = await approveX402({});
    identity.validity = "stale";

    const refused = await mint(approval.keyPair, approval.accessToken);

    expect(refused.status).toBe(401);
    expect(refused.json.error).toBe("invalid_token");
    identity.validity = "verified";
    expect((await mint(approval.keyPair, approval.accessToken)).status).toBe(
      200
    );
  });

  it("refuses the mint under another key", async () => {
    const approval = await approveX402({});

    const refused = await mint(
      await createTestDpopKeyPair(),
      approval.accessToken
    );

    expect(refused.status).toBe(401);
  });

  // R20: T3 R1 with an x402 CIBA token.
  it("refuses to exchange an x402 approval's token", async () => {
    const approval = await approveX402({});

    const exchange = await postTokenWithDpop(
      {
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        subject_token: approval.accessToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience: "http://localhost:3000",
        client_id: AGENT_CLIENT,
      },
      approval.keyPair
    );

    expect(exchange.status).toBe(400);
    expect(exchange.json.error).toBe("invalid_request");
  });
});
