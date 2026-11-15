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

import { GET as listRevocations } from "@/app/api/auth/oauth2/revoked/route";
import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { PAYMENT_AUTHORIZATION_SCOPE } from "@/lib/auth/oidc/payment-mint";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  confirmWithPasskey,
  decisionRecord,
  postDecision,
  requestIdForAuthReqId,
  requestStatus,
  signInApprover,
} from "@/test-utils/ciba-decision-test-utils";
import {
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

const WALLET_AUDIENCE = "urn:zentity:wallet:payment-token-test";
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
const REVOKE_URL = "http://localhost:3000/api/auth/oauth2/revoke";
const CLIENT_ID = "payment-token-agent";
const CLIENT_REQUESTED_RESOURCE = "http://localhost:3000";

const PAYMENT_RAR = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "50000000", unit: "base" },
  payment_id: "pay_123",
  intent_hash: `v1:sha256:${"A".repeat(43)}`,
  expires_at: { kind: "block_height", value: 4_056_276 },
};

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

describe("payment_authorization token", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        name: "Payment Agent",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
        tokenEndpointAuthMethod: "none",
        metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
      })
      .run();
  });

  afterEach(() => {
    mockEnv.walletAudience = WALLET_AUDIENCE;
    notificationMock.fail = false;
  });

  async function requestPayment(): Promise<string> {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      login_hint: userId,
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

  async function issuePaymentToken(): Promise<Record<string, unknown>> {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      login_hint: userId,
      authorization_details: JSON.stringify([PAYMENT_RAR]),
      resource: CLIENT_REQUESTED_RESOURCE,
    });
    if (authorize.status !== 200) {
      throw new Error(`bc-authorize answered ${authorize.status}`);
    }
    const authReqId = authorize.json.auth_req_id as string;

    const approval = await createAuthenticationContext({
      userId,
      loginMethod: "passkey",
      authenticatedAt: new Date(),
      sourceKind: "ciba_approval",
      referenceType: "ciba_request",
    });
    await db
      .update(cibaRequests)
      .set({
        status: "approved",
        authContextId: approval.id,
        // A Zentity approval makes the request reference its own hash.
        referenceId: hashCibaAuthReqId(authReqId),
      })
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
      .run();

    const token = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: CLIENT_ID,
    });
    if (token.status !== 200) {
      throw new Error(`token request answered ${token.status}`);
    }
    return token.json;
  }

  it("is issued for the wallet audience whatever resource the client requested", async () => {
    const response = await issuePaymentToken();
    const claims = decodeJwt(response.access_token as string);
    const audience = [claims.aud].flat();
    expect(audience).toContain(WALLET_AUDIENCE);
    expect(audience).not.toContain(CLIENT_REQUESTED_RESOURCE);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(120);
    expect(claims.authorization_details).toEqual([PAYMENT_RAR]);
    // RFC 9396 §7: the token response reports the details the token carries.
    expect(response.authorization_details).toEqual([PAYMENT_RAR]);
  });

  it("rejects a request with more than one payment entry", async () => {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      login_hint: userId,
      authorization_details: JSON.stringify([
        PAYMENT_RAR,
        { ...PAYMENT_RAR, payment_id: "pay_456" },
      ]),
    });

    expect(authorize.status).toBe(400);
    expect(authorize.json.error).toBe("invalid_request");
    expect(await db.select().from(cibaRequests).all()).toHaveLength(0);
  });

  it.each([
    ["is not JSON", "not-json"],
    ["has an unregistered type", JSON.stringify([{ type: "purchase" }])],
  ])("rejects authorization_details that %s", async (_case, details) => {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: userId,
      authorization_details: details,
    });

    expect(authorize.status).toBe(400);
    expect(authorize.json.error).toBe("invalid_authorization_details");
  });

  it("fails closed when WALLET_AUDIENCE is unset", async () => {
    mockEnv.walletAudience = undefined;

    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      login_hint: userId,
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
        body: new URLSearchParams({ token, client_id: CLIENT_ID }),
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
