import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.WALLET_AUDIENCE = "urn:zentity:wallet:payment-token-test";
});

import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { PAYMENT_AUTHORIZATION_SCOPE } from "@/lib/auth/oidc/payment-mint";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const WALLET_AUDIENCE = "urn:zentity:wallet:payment-token-test";
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
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

  it("is issued for the wallet audience whatever resource the client requested", async () => {
    const authorize = await postBcAuthorize({
      client_id: CLIENT_ID,
      scope: `openid ${PAYMENT_AUTHORIZATION_SCOPE}`,
      login_hint: userId,
      authorization_details: JSON.stringify([PAYMENT_RAR]),
      resource: CLIENT_REQUESTED_RESOURCE,
    });
    expect(authorize.status).toBe(200);
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
      .set({ status: "approved", authContextId: approval.id })
      .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
      .run();

    const token = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: CLIENT_ID,
    });
    expect(token.status).toBe(200);

    const claims = decodeJwt(token.json.access_token as string);
    const audience = [claims.aud].flat();
    expect(audience).toContain(WALLET_AUDIENCE);
    expect(audience).not.toContain(CLIENT_REQUESTED_RESOURCE);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(120);
    expect(claims.authorization_details).toEqual([PAYMENT_RAR]);
  });
});
