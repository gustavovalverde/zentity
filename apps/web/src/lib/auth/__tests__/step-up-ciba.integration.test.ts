import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { db } from "@/lib/db/connection";
import { sessions } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { identityBundles } from "@/lib/db/schema/identity";
import {
  firstPartyAuthSessions,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import {
  confirmWithPasskey,
  decisionRecord,
  postDecision,
  postDecisionOptions,
  requestStatus,
  signInApprover,
  type TestApprover,
} from "@/test-utils/ciba-decision-test-utils";
import {
  createTestCibaRequest,
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const TEST_CLIENT_ID = "step-up-ciba-test";
const FPA_CLIENT_ID = "step-up-ciba-fpa-test";
const FPA_CLIENT_SECRET = "step-up-ciba-fpa-secret";
const PUBLIC_FPA_CLIENT_ID = "step-up-ciba-public-fpa-test";
const POLL_CLIENT_ID = "step-up-ciba-poll-test";
const DECISION_URL = "http://localhost:3000/api/auth/ciba/decision";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
let defaultAuthContextId: string | null = null;

/** `acr_values` as the CIBA plugin's adapter stores them: a JSON array. */
function storedAcr(...values: string[]): string {
  return JSON.stringify(values);
}

async function createTestClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: TEST_CLIENT_ID,
      name: "Step-Up CIBA Test",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

/**
 * A first-party client that can continue at the Authorization Challenge
 * Endpoint: confidential, with the authorization_code grant and skip_consent.
 */
async function createFirstPartyClient(
  clientId = FPA_CLIENT_ID,
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      clientSecret: crypto
        .createHash("sha256")
        .update(FPA_CLIENT_SECRET)
        .digest("base64url"),
      name: "Step-Up CIBA FPA Test",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE, "authorization_code"]),
      tokenEndpointAuthMethod: "client_secret_post",
      firstParty: true,
      skipConsent: true,
      ...overrides,
    })
    .run();
}

async function createPollClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: POLL_CLIENT_ID,
      name: "Step-Up CIBA Poll Test",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
    })
    .run();
}

async function postBcAuthorize(body: Record<string, string>) {
  const response = await auth.handler(
    new Request(BC_AUTHORIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

async function insertCibaRequest(
  overrides: Partial<typeof cibaRequests.$inferInsert> = {}
) {
  const authReqId = overrides.authReqId ?? crypto.randomUUID();
  const status = overrides.status ?? "pending";
  await db
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
      // Plugin stores the hash at rest; callers send the raw value.
      authReqId: hashCibaAuthReqId(authReqId),
    })
    .run();
  return authReqId;
}

async function insertSession(userId: string, authContextId: string) {
  const token = crypto.randomUUID();
  await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId,
      token,
      authContextId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return `${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
}

async function seedTier1User(userId: string) {
  await db
    .insert(identityBundles)
    .values({
      userId,
      fheKeyId: "test-fhe-key-id",
      fheStatus: "complete",
      validityStatus: "verified",
    })
    .run();
}

async function approveRequest(authReqId: string, sessionToken: string) {
  const row = await db
    .select({ id: cibaRequests.id })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .get();
  return auth.handler(
    new Request(DECISION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `better-auth.session_token=${sessionToken}`,
      },
      body: JSON.stringify({ request_id: row?.id, decision: "approved" }),
    })
  );
}

describe("CIBA step-up: acr_values at approval time", () => {
  let userId: string;
  let sessionToken: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createTestClient();
    defaultAuthContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "better_auth",
        referenceType: "session",
      })
    ).id;
    sessionToken = await insertSession(userId, defaultAuthContextId);
  });

  it("tier-1 user cannot approve CIBA request requiring tier-2", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error_description?: string };
    expect(body.error_description).toContain("tier-1");
    expect(body.error_description).toContain("urn:zentity:assurance:tier-2");
  });

  it("tier-0 user cannot approve CIBA request requiring tier-1", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: storedAcr("urn:zentity:assurance:tier-1"),
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error_description?: string };
    expect(body.error_description).toContain("tier-0");
  });

  it("tier-1 user can approve CIBA request requiring tier-1", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: storedAcr("urn:zentity:assurance:tier-1"),
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(200);
  });

  it("higher tier satisfies lower requirement", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: storedAcr("urn:zentity:assurance:tier-0"),
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(200);
  });

  it("no acr_values passes without enforcement", async () => {
    const authReqId = await insertCibaRequest({ userId });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(200);
  });

  it("preference order: first satisfiable ACR wins", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: storedAcr(
        "urn:zentity:assurance:tier-3",
        "urn:zentity:assurance:tier-1"
      ),
    });

    const response = await approveRequest(authReqId, sessionToken);

    // tier-1 satisfies the second value, so the approval succeeds
    expect(response.status).toBe(200);
  });

  it("enforces a space-separated row stored before the plugin owned acr_values", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      acrValues: "urn:zentity:assurance:tier-3 urn:zentity:assurance:tier-2",
    });

    const response = await approveRequest(authReqId, sessionToken);

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error_description?: string };
    expect(body.error_description).toContain(
      "urn:zentity:assurance:tier-3 urn:zentity:assurance:tier-2"
    );
  });
});

describe("CIBA step-up: acr_values sent to bc-authorize", () => {
  let userId: string;
  let sessionToken: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createPollClient();
    const authContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "better_auth",
        referenceType: "session",
      })
    ).id;
    sessionToken = await insertSession(userId, authContextId);
  });

  it("stores the plugin's JSON array, enforces it at approval, and re-checks it at the poll", async () => {
    const authorize = await postBcAuthorize({
      client_id: POLL_CLIENT_ID,
      scope: "openid",
      login_hint: userId,
      acr_values: "urn:zentity:assurance:tier-1",
    });
    expect(authorize.status).toBe(200);
    const authReqId = authorize.json.auth_req_id as string;

    const row = await db
      .select({ acrValues: cibaRequests.acrValues })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
      .get();
    expect(row?.acrValues).toBe(storedAcr("urn:zentity:assurance:tier-1"));

    // A tier-0 user cannot approve a tier-1 request.
    const refused = await approveRequest(authReqId, sessionToken);
    expect(refused.status).toBe(403);

    await seedTier1User(userId);
    const approved = await approveRequest(authReqId, sessionToken);
    expect(approved.status).toBe(200);

    // The user's tier drops between approval and the poll.
    await db
      .delete(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .run();
    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: POLL_CLIENT_ID,
    });
    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.error_description).toContain("urn:zentity:assurance:tier-1");
  });
});

describe("CIBA step-up: acr_values at token exchange (safety net)", () => {
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

  it("approved request with unsatisfied acr_values returns interaction_required", async () => {
    // Tier-0 user with approved request requiring tier-2
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.error_description).toContain("tier-0");
  });

  it("approved request with satisfied acr_values issues tokens", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-1"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
  });

  it("no acr_values on CIBA request bypasses safety net", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
  });

  it("pending request with acr_values still returns authorization_pending", async () => {
    const authReqId = await insertCibaRequest({
      userId,
      status: "pending",
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("authorization_pending");
  });
});

describe("CIBA step-up: first-party client (FPA) path", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createFirstPartyClient();
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

  it("FPA client with unsatisfied acr_values returns 403 + auth_session", async () => {
    const authReqId = await insertCibaRequest({
      clientId: FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: storedAcr(
        "urn:zentity:assurance:tier-3",
        "urn:zentity:assurance:tier-2"
      ),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: FPA_CLIENT_ID,
      client_secret: FPA_CLIENT_SECRET,
    });

    expect(status).toBe(403);
    expect(json.error).toBe("insufficient_authorization");
    expect(json.auth_session).toBeTypeOf("string");
    expect(json.error_description).toContain("tier-0");

    // The step-up row waits for the user to sign in again, and the code it
    // leads to asks for the same acr_values in the parameter form.
    const rows = await db.select().from(firstPartyAuthSessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: FPA_CLIENT_ID,
      userId,
      state: "pending",
      sessionId: null,
      dpopJkt: expect.any(String),
    });
    expect(JSON.parse(rows[0]?.request ?? "{}")).toMatchObject({
      scope: "openid",
      acr_values: "urn:zentity:assurance:tier-3 urn:zentity:assurance:tier-2",
    });
  });

  it("refuses a poll that authenticates as another first-party client", async () => {
    await createFirstPartyClient("step-up-ciba-other-fpa");
    const authReqId = await insertCibaRequest({
      clientId: FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: "step-up-ciba-other-fpa",
      client_secret: FPA_CLIENT_SECRET,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("invalid_client");
    expect(json.auth_session).toBeUndefined();
    expect(await db.select().from(firstPartyAuthSessions).all()).toHaveLength(
      0
    );
  });

  it("a public first-party client gets interaction_required, since the CIBA grant has no session or DPoP binding", async () => {
    await createFirstPartyClient(PUBLIC_FPA_CLIENT_ID, {
      clientSecret: null,
      tokenEndpointAuthMethod: "none",
    });
    const authReqId = await insertCibaRequest({
      clientId: PUBLIC_FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: PUBLIC_FPA_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.auth_session).toBeUndefined();
  });

  it("a payment approval gets interaction_required, since a code cannot carry authorization_details", async () => {
    const authReqId = await insertCibaRequest({
      clientId: FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
      authorizationDetails: JSON.stringify([
        {
          type: "payment_authorization",
          amount: { value: "1", currency: "USD" },
        },
      ]),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: FPA_CLIENT_ID,
      client_secret: FPA_CLIENT_SECRET,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.auth_session).toBeUndefined();
  });

  it("non-FPA client with unsatisfied acr_values still returns 400 interaction_required", async () => {
    await createTestClient();
    const authReqId = await insertCibaRequest({
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-2"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(status).toBe(400);
    expect(json.error).toBe("interaction_required");
    expect(json.auth_session).toBeUndefined();
  });

  it("FPA client with satisfied acr_values issues tokens normally", async () => {
    await seedTier1User(userId);
    const authReqId = await insertCibaRequest({
      clientId: FPA_CLIENT_ID,
      userId,
      status: "approved",
      acrValues: storedAcr("urn:zentity:assurance:tier-1"),
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: FPA_CLIENT_ID,
      client_secret: FPA_CLIENT_SECRET,
    });

    expect(status).toBe(200);
    expect(json.access_token).toBeDefined();
  });
});

describe("CIBA approval ceremony", () => {
  let userId: string;
  let approver: TestApprover;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await createPollClient();
    approver = await signInApprover(userId);
  });

  async function pendingRequest(scope: string) {
    const { requestId, authReqId } = await createTestCibaRequest({
      clientId: POLL_CLIENT_ID,
      userId,
      scope,
    });
    return { requestId, authReqId };
  }

  // R23: an old service worker posts without a channel from a notification.
  it.each([
    ["no channel", undefined],
    ["the push channel", "push" as const],
  ])(
    "refuses a notification approval of a page-only request sent with %s",
    async (_case, channel) => {
      const { requestId } = await pendingRequest("openid email");

      const response = await postDecision(approver, {
        request_id: requestId,
        ...(channel ? { channel } : {}),
      });

      expect(response.status).toBe(403);
      expect(response.json).toEqual(
        expect.objectContaining({
          error: "review_required",
          error_description: "Open the approval page to review this request",
        })
      );
      expect(await requestStatus(requestId)).toBe("pending");
    }
  );

  it.each([
    ["no channel", undefined],
    ["the push channel", "push" as const],
  ])(
    "accepts a notification approval of an inline request sent with %s",
    async (_case, channel) => {
      const { requestId } = await pendingRequest("openid compliance:read");

      const response = await postDecision(approver, {
        request_id: requestId,
        ...(channel ? { channel } : {}),
      });

      expect(response.status).toBe(200);
      expect(await decisionRecord(requestId)).toEqual(
        expect.objectContaining({
          approvalMethod: "session",
          approvalChannel: "push",
        })
      );
    }
  );

  it("accepts a page approval of a page-only request", async () => {
    const { requestId } = await pendingRequest("openid email");

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(200);
  });

  it("lets a notification deny a page-only request", async () => {
    const { requestId } = await pendingRequest("openid email");

    const response = await postDecision(approver, {
      request_id: requestId,
      decision: "denied",
    });

    expect(response.status).toBe(200);
    expect(await decisionRecord(requestId)).toEqual(
      expect.objectContaining({ decision: "denied", approvalChannel: "push" })
    );
  });

  // R6 and R17: a verified assertion is recorded and stated to the client.
  it("states a user-verified approval in the token response and the ID token", async () => {
    const authenticator = await new TestAuthenticator().register(userId);
    const { requestId, authReqId } = await pendingRequest(
      "openid compliance:read"
    );
    const webauthn = await confirmWithPasskey(
      approver,
      requestId,
      authenticator
    );
    const verifiedAt = new Date(Date.now() + 5000);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(verifiedAt);
    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
      webauthn,
    });
    vi.useRealTimers();

    expect(response.status).toBe(200);
    expect(await decisionRecord(requestId)).toEqual(
      expect.objectContaining({
        approvalMethod: "user_verification",
        approvalChannel: "page",
      })
    );
    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: POLL_CLIENT_ID,
    });
    expect(status).toBe(200);
    const verifiedAtSeconds = Math.floor(verifiedAt.getTime() / 1000);
    expect(json.oversight).toEqual({
      method: "user_verification",
      approved_at: verifiedAtSeconds,
    });
    const idToken = decodeJwt(json.id_token as string);
    expect(idToken.amr).toEqual(["pop", "user", "mfa"]);
    expect(idToken.auth_time).toBe(verifiedAtSeconds);
  });

  describe("decision errors", () => {
    it("answers an unknown request with 404 on both endpoints", async () => {
      for (const response of [
        await postDecisionOptions(approver, "missing"),
        await postDecision(approver, { request_id: "missing" }),
      ]) {
        expect(response.status).toBe(404);
        expect(response.json).toEqual(
          expect.objectContaining({
            error: "invalid_request",
            error_description: "Unknown request",
          })
        );
      }
    });

    it("answers a decided request with 400 on both endpoints", async () => {
      const { requestId } = await pendingRequest("openid");
      expect(
        (
          await postDecision(approver, {
            request_id: requestId,
            channel: "page",
          })
        ).status
      ).toBe(200);

      for (const response of [
        await postDecisionOptions(approver, requestId),
        await postDecision(approver, {
          request_id: requestId,
          channel: "page",
        }),
      ]) {
        expect(response.status).toBe(400);
        expect(response.json.error_description).toBe(
          "This request was already approved"
        );
      }
    });

    it("answers an expired request with expired_token on both endpoints", async () => {
      const { requestId } = await createTestCibaRequest({
        clientId: POLL_CLIENT_ID,
        userId,
        expiresAt: new Date(Date.now() - 1000),
      });

      for (const response of [
        await postDecisionOptions(approver, requestId),
        await postDecision(approver, {
          request_id: requestId,
          channel: "page",
        }),
      ]) {
        expect(response.status).toBe(400);
        expect(response.json.error).toBe("expired_token");
      }
    });

    it("answers options for a user without a passkey with passkey_required", async () => {
      const { requestId } = await pendingRequest("openid");

      const response = await postDecisionOptions(approver, requestId);

      expect(response.status).toBe(409);
      expect(response.json.error).toBe("passkey_required");
    });

    it("asks to start again when no challenge was issued", async () => {
      const authenticator = await new TestAuthenticator().register(userId);
      const { requestId } = await pendingRequest("openid");

      const response = await postDecision(approver, {
        request_id: requestId,
        channel: "page",
        webauthn: authenticator.assert({ challenge: "bm90LWlzc3VlZA" }),
      });

      expect(response.status).toBe(400);
      expect(response.json).toEqual(
        expect.objectContaining({
          error: "invalid_request",
          error_description: "Start the passkey confirmation again",
        })
      );
    });

    it("refuses an assertion that fails verification", async () => {
      const authenticator = await new TestAuthenticator().register(userId);
      const { requestId } = await pendingRequest("openid");
      const webauthn = await confirmWithPasskey(
        approver,
        requestId,
        authenticator,
        { userVerified: false }
      );

      const response = await postDecision(approver, {
        request_id: requestId,
        channel: "page",
        webauthn,
      });

      expect(response.status).toBe(403);
      expect(response.json).toEqual(
        expect.objectContaining({
          error: "insufficient_user_authentication",
          error_description: "Passkey confirmation failed",
        })
      );
      expect(await requestStatus(requestId)).toBe("pending");
    });

    it("asks a session without an authentication context to sign in again", async () => {
      const { requestId } = await pendingRequest("openid");
      await db
        .update(sessions)
        .set({ authContextId: null })
        .where(eq(sessions.id, approver.sessionId))
        .run();

      const response = await postDecision(approver, {
        request_id: requestId,
        channel: "page",
      });

      expect(response.status).toBe(401);
      expect(response.json.error).toBe("login_required");
    });
  });
});
