import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";

import { auth } from "../auth-config";

const CLIENT_ID = "ciba-origin-client";
const AUTH_BASE = "http://localhost:3000/api/auth";

function postDecision(
  decision: "approved" | "denied",
  requestId: string,
  sessionToken: string,
  headers: Record<string, string>
) {
  return auth.handler(
    new Request(`${AUTH_BASE}/ciba/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `better-auth.session_token=${sessionToken}`,
        ...headers,
      },
      body: JSON.stringify({ request_id: requestId, decision }),
    })
  );
}

async function requestStatus(requestId: string) {
  const row = await db
    .select({ status: cibaRequests.status })
    .from(cibaRequests)
    .where(eq(cibaRequests.id, requestId))
    .get();
  return row?.status;
}

describe("CIBA approval origin", () => {
  let userId: string;
  let sessionToken: string;
  let testDefaultSkip: unknown;

  // Better Auth skips origin checks under NODE_ENV=test; apply the setting
  // production derives from the config instead.
  beforeEach(async () => {
    const context = (await auth.$context) as { skipOriginCheck: unknown };
    testDefaultSkip = context.skipOriginCheck;
    const advanced = auth.options.advanced as {
      disableOriginCheck?: boolean | string[];
    };
    context.skipOriginCheck = advanced.disableOriginCheck ?? false;
    await resetDatabase();
    userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
        tokenEndpointAuthMethod: "none",
      })
      .run();
    const { token } = await createTestSession(userId);
    sessionToken = `${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
  });

  afterEach(async () => {
    const context = (await auth.$context) as { skipOriginCheck: unknown };
    context.skipOriginCheck = testDefaultSkip;
  });

  it.each(["approved", "denied"] as const)(
    "refuses a %s decision from another site that carries the user's cookie",
    async (decision) => {
      const { requestId } = await createTestCibaRequest({
        clientId: CLIENT_ID,
        userId,
      });

      const response = await postDecision(decision, requestId, sessionToken, {
        origin: "https://sibling.example.com",
        "sec-fetch-site": "cross-site",
      });

      expect(response.status).toBe(403);
      expect(await requestStatus(requestId)).toBe("pending");
    }
  );

  it("accepts the push service worker's same-origin request", async () => {
    const { requestId } = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
    });

    const response = await postDecision("denied", requestId, sessionToken, {
      origin: "null",
      "sec-fetch-site": "same-origin",
    });

    expect(response.status).toBe(200);
    expect(await requestStatus(requestId)).toBe("denied");
  });
});

// R18: the options and decision endpoints each have their own limit.
describe("CIBA approval rate limits", () => {
  let userId: string;
  let sessionToken: string;
  let rateLimit: { enabled: boolean };
  let wasEnabled: boolean;

  beforeEach(async () => {
    rateLimit = ((await auth.$context) as { rateLimit: { enabled: boolean } })
      .rateLimit;
    wasEnabled = rateLimit.enabled;
    rateLimit.enabled = true;
    await resetDatabase();
    userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
        tokenEndpointAuthMethod: "none",
      })
      .run();
    const { token } = await createTestSession(userId);
    sessionToken = `${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`;
  });

  afterEach(() => {
    rateLimit.enabled = wasEnabled;
  });

  function post(path: string, body: Record<string, unknown>, ip: string) {
    return auth.handler(
      new Request(`${AUTH_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `better-auth.session_token=${sessionToken}`,
          "x-forwarded-for": ip,
        },
        body: JSON.stringify(body),
      })
    );
  }

  it("counts options calls apart from decisions", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const { requestId } = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
    });

    for (let call = 0; call < 20; call++) {
      const response = await post(
        "/ciba/decision/options",
        { request_id: requestId },
        ip
      );
      expect(response.status).not.toBe(429);
    }

    const decision = await post(
      "/ciba/decision",
      { request_id: requestId, decision: "denied", channel: "page" },
      ip
    );
    expect(decision.status).toBe(200);

    const limited = await post(
      "/ciba/decision/options",
      { request_id: requestId },
      ip
    );
    expect(limited.status).toBe(429);
  });
});
