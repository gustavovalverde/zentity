import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import {
  computePairwiseSub,
  pairwiseValue,
  resolveSubForClientId,
  resolveUserIdFromSub,
} from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  oauthClientResources,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { postTokenWithDpop } from "@/test-utils/dpop-test-utils";

const BASE = "http://localhost:3000";
const AUTH_URL = `${BASE}/api/auth`;
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const CLIENT_ID = "pairwise-agent";
const REDIRECT_URI = "http://localhost:4100/callback";
const MCP_RESOURCE = env.MCP_PUBLIC_URL;
const RESOURCE_SERVER_ID = "mcp-resource-server";
const RESOURCE_SERVER_SECRET = "resource-server-secret";

async function postForm(path: string, body: Record<string, string>) {
  const response = await auth.handler(
    new Request(`${AUTH_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  const json =
    "response" in parsed
      ? (parsed.response as Record<string, unknown>)
      : parsed;
  return { status: response.status, json };
}

async function mintMcpAccessToken(userId: string): Promise<string> {
  const { authReqId } = await createTestCibaRequest({
    clientId: CLIENT_ID,
    userId,
    status: "approved",
    resources: JSON.stringify([MCP_RESOURCE]),
  });
  const { status, json } = await postTokenWithDpop({
    grant_type: CIBA_GRANT_TYPE,
    auth_req_id: authReqId,
    client_id: CLIENT_ID,
  });
  if (status !== 200) {
    throw new Error(`CIBA token request failed: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

describe("access token subjects", () => {
  let userId: string;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        name: "Pairwise Agent",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code", CIBA_GRANT_TYPE]),
        tokenEndpointAuthMethod: "none",
        subjectType: "pairwise",
        metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
      })
      .run();
  });

  // R15
  it("refuses a backchannel request for two resources outside Zentity", async () => {
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oauth2/bc-authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams([
          ["client_id", CLIENT_ID],
          ["scope", "openid"],
          [
            "login_hint",
            (await resolveSubForClientId(userId, CLIENT_ID)) ?? "",
          ],
          ["resource", MCP_RESOURCE],
          ["resource", "https://other-resource.example"],
        ]),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_target",
      error_description: "request one resource outside Zentity per token",
    });
    expect(await db.select().from(cibaRequests).all()).toHaveLength(0);
  });

  it("refuses an authorization request for two resources outside Zentity", async () => {
    const query = new URLSearchParams([
      ["client_id", CLIENT_ID],
      ["response_type", "code"],
      ["redirect_uri", REDIRECT_URI],
      ["scope", "openid"],
      ["code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"],
      ["code_challenge_method", "S256"],
      ["resource", MCP_RESOURCE],
      ["resource", "https://other-resource.example"],
    ]);
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oauth2/authorize?${query}`)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_target",
      error_description: "request one resource outside Zentity per token",
    });
  });

  it("refuses a form-encoded authorization request for two resources outside Zentity", async () => {
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oauth2/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams([
          ["client_id", CLIENT_ID],
          ["response_type", "code"],
          ["redirect_uri", REDIRECT_URI],
          ["scope", "openid"],
          ["code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"],
          ["code_challenge_method", "S256"],
          ["resource", "https://other-resource.example"],
          ["resource", MCP_RESOURCE],
        ]),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_target",
      error_description: "request one resource outside Zentity per token",
    });
  });

  it("drops Zentity-hosted resources from backchannel requests", async () => {
    const pairwiseSub = await resolveSubForClientId(userId, CLIENT_ID);
    for (const [resource, stored] of [
      [BASE, null],
      [MCP_RESOURCE, MCP_RESOURCE],
    ] as const) {
      const { status, json } = await postForm("/oauth2/bc-authorize", {
        client_id: CLIENT_ID,
        scope: "openid",
        login_hint: pairwiseSub as string,
        resource,
      });
      expect({ status, json }).toMatchObject({ status: 200 });

      const rows = await db
        .select({ resources: cibaRequests.resources })
        .from(cibaRequests)
        .where(eq(cibaRequests.clientId, CLIENT_ID))
        .all();
      const resources = rows.at(-1)?.resources;
      expect(resources ? JSON.parse(resources) : null).toEqual(
        stored ? [stored] : null
      );
    }
  });

  it("accepts the client's pairwise subject as a CIBA login hint", async () => {
    const pairwiseSub = (await resolveSubForClientId(userId, CLIENT_ID)) ?? "";

    const { status, json } = await postForm("/oauth2/bc-authorize", {
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: pairwiseSub,
    });

    expect({ status, json }).toMatchObject({ status: 200 });
    const [request] = await db
      .select({ userId: cibaRequests.userId })
      .from(cibaRequests)
      .where(eq(cibaRequests.clientId, CLIENT_ID))
      .all();
    expect(request?.userId).toBe(userId);
  });

  it("rejects another client's pairwise subject as a CIBA login hint", async () => {
    const { status } = await postForm("/oauth2/bc-authorize", {
      client_id: CLIENT_ID,
      scope: "openid",
      login_hint: await computePairwiseSub(
        userId,
        new URL("https://other-rp.example/callback").host,
        env.PAIRWISE_SECRET
      ),
    });

    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("issues opaque tokens when no resource outside Zentity is requested", async () => {
    const { authReqId } = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
      status: "approved",
    });

    const { status, json } = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      auth_req_id: authReqId,
      client_id: CLIENT_ID,
    });

    expect(status).toBe(200);
    expect((json.access_token as string).split(".")).toHaveLength(1);
  });

  it("carries the audience's pairwise subject in JWT access tokens", async () => {
    const payload = decodeJwt(await mintMcpAccessToken(userId));
    const clientSub = await computePairwiseSub(
      userId,
      new URL(REDIRECT_URI).host,
      env.PAIRWISE_SECRET
    );

    expect(payload.aud).toContain(MCP_RESOURCE);
    expect(payload.sub).toBe(
      await pairwiseValue(
        `${new URL(REDIRECT_URI).host} ${MCP_RESOURCE}`,
        userId
      )
    );
    expect(payload.sub).not.toBe(clientSub);
    // The provider writes the user id encrypted, for its own endpoints.
    expect(payload.ba_sub).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toContain(userId);
    // Only the client's own subject names the user back.
    await expect(
      resolveUserIdFromSub(payload.sub as string, CLIENT_ID)
    ).resolves.toBeNull();
  });

  it("introspects a JWT access token with its own subject", async () => {
    const accessToken = await mintMcpAccessToken(userId);
    await db
      .insert(oauthClients)
      .values({
        clientId: RESOURCE_SERVER_ID,
        clientSecret: createHash("sha256")
          .update(RESOURCE_SERVER_SECRET)
          .digest("base64url"),
        name: "Resource Server",
        redirectUris: JSON.stringify([]),
        grantTypes: JSON.stringify(["client_credentials"]),
        tokenEndpointAuthMethod: "client_secret_post",
      })
      .run();
    await db
      .insert(oauthClientResources)
      .values({
        id: "rs-link",
        clientId: RESOURCE_SERVER_ID,
        resourceId: MCP_RESOURCE,
      })
      .run();

    const { GET: serveJwks } = await import("@/app/api/auth/oauth2/jwks/route");
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      String(input instanceof Request ? input.url : input).endsWith(
        "/oauth2/jwks"
      )
        ? serveJwks()
        : realFetch(input, init)
    );
    const response = await auth.handler(
      new Request(`${AUTH_URL}/oauth2/introspect`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: RESOURCE_SERVER_ID,
          client_secret: RESOURCE_SERVER_SECRET,
          token: accessToken,
          token_type_hint: "access_token",
        }),
      })
    );
    const introspection = (await response.json()) as Record<string, unknown>;

    expect(introspection.active).toBe(true);
    expect(introspection.sub).toBe(decodeJwt(accessToken).sub);
  });
});
