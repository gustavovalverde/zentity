import { beforeEach, describe, expect, it } from "vitest";

import { resolveSubForClientId } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

import { auth } from "../auth-config";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const BC_AUTHORIZE_URL = "http://localhost:3000/api/auth/oauth2/bc-authorize";
const CLIENT_ID = "login-hint-agent";
const OTHER_CLIENT_ID = "login-hint-other-agent";

async function createPairwiseClient(clientId: string, redirectHost: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify([`https://${redirectHost}/callback`]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      tokenEndpointAuthMethod: "none",
      subjectType: "pairwise",
      metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
    })
    .run();
}

async function bcAuthorize(clientId: string, loginHint: string) {
  const response = await auth.handler(
    new Request(BC_AUTHORIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        scope: "openid",
        login_hint: loginHint,
      }),
    })
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("CIBA login_hint resolution", () => {
  let userId: string;
  let email: string;

  beforeEach(async () => {
    await resetDatabase();
    email = `ciba-hint-${crypto.randomUUID()}@example.com`;
    userId = await createTestUser({ email });
    await createPairwiseClient(CLIENT_ID, "agent.example.com");
    await createPairwiseClient(OTHER_CLIENT_ID, "other.example.com");
  });

  it("accepts the subject identifier the client received for the user", async () => {
    const sub = await resolveSubForClientId(userId, CLIENT_ID);

    const { status, body } = await bcAuthorize(CLIENT_ID, sub as string);

    expect(status).toBe(200);
    expect(body.auth_req_id).toEqual(expect.any(String));
  });

  it("answers a registered email exactly like an unregistered one", async () => {
    const registered = await bcAuthorize(CLIENT_ID, email);
    const unregistered = await bcAuthorize(
      CLIENT_ID,
      "nobody-here@example.com"
    );

    expect(registered).toEqual(unregistered);
    expect(registered.body.error).toBe("unknown_user_id");
  });

  it("answers a real internal user id exactly like a made-up one", async () => {
    const real = await bcAuthorize(CLIENT_ID, userId);
    const madeUp = await bcAuthorize(CLIENT_ID, crypto.randomUUID());

    expect(real).toEqual(madeUp);
  });

  it("does not accept a subject issued to a client in another sector", async () => {
    const otherSub = await resolveSubForClientId(userId, OTHER_CLIENT_ID);

    const { status, body } = await bcAuthorize(CLIENT_ID, otherSub as string);

    expect(status).toBe(400);
    expect(body.error).toBe("unknown_user_id");
  });
});
