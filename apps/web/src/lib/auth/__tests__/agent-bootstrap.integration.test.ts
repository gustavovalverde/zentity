import crypto from "node:crypto";

import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { eq } from "drizzle-orm";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/session";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { introspectZentityAccessToken } from "@/lib/auth/oidc/resource-principal";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import { agentSessions } from "@/lib/db/schema/agent";
import {
  oauthAccessTokens,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestUser,
  findStoredOpaqueAccessToken,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const APP_URL = "http://localhost:3000";
const CLIENT_ID = "pairwise-bootstrap-client";
const REDIRECT_URI = "http://localhost:3100/callback";
const WEB_CLIENT_ID = "web-bootstrap-client";
const WEB_REDIRECT_URI = "https://app.example.com/callback";
const BOOTSTRAP_SCOPE = "agent:host.register agent:session.register";
// The scopes MCP stdio requests at sign-in, bootstrap scopes included.
const LOGIN_SCOPES = ["openid", "email", ...BOOTSTRAP_SCOPE.split(" ")];

function hashOpaqueAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

async function createPairwiseClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: CLIENT_ID,
      grantTypes: JSON.stringify([
        "authorization_code",
        TOKEN_EXCHANGE_GRANT_TYPE,
      ]),
      name: "Pairwise Bootstrap Client",
      redirectUris: JSON.stringify([REDIRECT_URI]),
      subjectType: "pairwise",
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

async function createWebClient() {
  await db
    .insert(oauthClients)
    .values({
      clientId: WEB_CLIENT_ID,
      grantTypes: JSON.stringify([
        "authorization_code",
        TOKEN_EXCHANGE_GRANT_TYPE,
      ]),
      name: "Web Bootstrap Client",
      redirectUris: JSON.stringify([WEB_REDIRECT_URI]),
      subjectType: "pairwise",
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

describe("agent bootstrap token exchange", () => {
  let authContextId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    authContextId = (
      await createAuthenticationContext({
        authenticatedAt: new Date(),
        loginMethod: "passkey",
        sourceKind: "token_exchange",
        userId,
      })
    ).id;
    await createPairwiseClient();
    await createWebClient();
  });

  // R12, R18: an installed client signs in with the bootstrap scopes,
  // exchanges its own login, and registers a host and a session that keep the
  // sign-in's authentication context.
  it("registers a host and a session from a login that holds the bootstrap scopes", async () => {
    const loginToken = "opaque-login-token";
    const dpopKeyPair = await createTestDpopKeyPair();
    const dpopJkt = await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256");

    await db
      .insert(oauthAccessTokens)
      .values({
        authContextId,
        clientId: CLIENT_ID,
        confirmation: JSON.stringify({ jkt: dpopJkt }),
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: JSON.stringify(LOGIN_SCOPES),
        token: hashOpaqueAccessToken(loginToken),
        userId,
      })
      .run();

    const { json, status } = await postTokenWithDpop(
      {
        audience: APP_URL,
        client_id: CLIENT_ID,
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        scope: BOOTSTRAP_SCOPE,
        subject_token: loginToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      },
      dpopKeyPair
    );

    expect(status).toBe(200);
    expect(json.token_type).toBe("DPoP");
    expect(json.scope).toBe(BOOTSTRAP_SCOPE);

    const bootstrapToken = json.access_token as string;
    const stored = await findStoredOpaqueAccessToken(bootstrapToken);
    expect(stored?.accessTokenClaims.zentity_token_use).toBe(
      AGENT_BOOTSTRAP_TOKEN_USE
    );
    const validated = await introspectZentityAccessToken(bootstrapToken);
    expect(validated.payload.zentity_token_use).toBe(AGENT_BOOTSTRAP_TOKEN_USE);
    expect(stored?.scopes.join(" ")).toBe(BOOTSTRAP_SCOPE);
    expect(stored?.userId).toBe(userId);
    expect(stored?.dpopJkt).toBe(dpopJkt);
    expect(stored?.authContextId).toBe(authContextId);

    const hostKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const hostJwk = await exportJWK(hostKeys.publicKey);
    const hostDid = encodeEd25519DidKeyFromJwk({
      crv: "Ed25519",
      kty: "OKP",
      x: hostJwk.x as string,
    });
    const registerUrl = `${APP_URL}/api/auth/agent/host/register`;
    const { POST: registerHost } = await import(
      "@/app/api/auth/agent/host/register/route"
    );
    const hostResponse = await registerHost(
      new Request(registerUrl, {
        method: "POST",
        headers: {
          Authorization: `DPoP ${bootstrapToken}`,
          "Content-Type": "application/json",
          DPoP: await buildDpopProof(
            dpopKeyPair,
            "POST",
            registerUrl,
            bootstrapToken
          ),
        },
        body: JSON.stringify({ did: hostDid, name: "Bootstrap Host" }),
      })
    );

    expect(hostResponse.status).toBe(201);
    const host = (await hostResponse.json()) as {
      created: boolean;
      did: string;
      hostId: string;
    };
    expect(host).toEqual(
      expect.objectContaining({ created: true, did: hostDid })
    );

    const agentKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const agentJwk = await exportJWK(agentKeys.publicKey);
    const hostJwt = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", typ: "host-attestation+jwt" })
      .setIssuer(host.hostId)
      .setSubject("agent-registration")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(hostKeys.privateKey);
    const sessionUrl = `${APP_URL}/api/auth/agent/register`;
    const { POST: registerSession } = await import(
      "@/app/api/auth/agent/register/route"
    );
    const sessionResponse = await registerSession(
      new Request(sessionUrl, {
        method: "POST",
        headers: {
          Authorization: `DPoP ${bootstrapToken}`,
          "Content-Type": "application/json",
          DPoP: await buildDpopProof(
            dpopKeyPair,
            "POST",
            sessionUrl,
            bootstrapToken
          ),
        },
        body: JSON.stringify({
          hostJwt,
          did: encodeEd25519DidKeyFromJwk({
            crv: "Ed25519",
            kty: "OKP",
            x: agentJwk.x as string,
          }),
          display: { name: "Bootstrap Agent", runtime: "node" },
        }),
      })
    );

    expect(sessionResponse.status).toBe(201);
    const { sessionId } = (await sessionResponse.json()) as {
      sessionId: string;
    };
    const session = await db
      .select({ authContextId: agentSessions.authContextId })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.authContextId).toBe(authContextId);
  });

  it("rejects direct opaque login tokens on bootstrap routes", async () => {
    const loginToken = "opaque-login-token";

    await db
      .insert(oauthAccessTokens)
      .values({
        authContextId,
        clientId: CLIENT_ID,
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: JSON.stringify(["openid"]),
        token: hashOpaqueAccessToken(loginToken),
        userId,
      })
      .run();

    const { POST } = await import("@/app/api/auth/agent/host/register/route");
    const response = await POST(
      new Request(`${APP_URL}/api/auth/agent/host/register`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          did: encodeEd25519DidKeyFromJwk({
            crv: "Ed25519",
            kty: "OKP",
            x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }),
          name: "Bootstrap Host",
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(
      response.headers.get("WWW-Authenticate")?.startsWith("Bearer ")
    ).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_token",
      error_description: "bootstrap access token required",
    });
  });

  /** Stores the pairwise client's DPoP-bound opaque login token. */
  async function storeLoginToken(scopes: string[]) {
    const loginToken = `login-${crypto.randomUUID()}`;
    const dpopKeyPair = await createTestDpopKeyPair();
    await db
      .insert(oauthAccessTokens)
      .values({
        authContextId,
        clientId: CLIENT_ID,
        confirmation: JSON.stringify({
          jkt: await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256"),
        }),
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: JSON.stringify(scopes),
        token: hashOpaqueAccessToken(loginToken),
        userId,
      })
      .run();
    return { dpopKeyPair, loginToken };
  }

  function exchangeLogin(
    login: { dpopKeyPair: DpopKeyPair; loginToken: string },
    scope?: string
  ) {
    return postTokenWithDpop(
      {
        audience: APP_URL,
        client_id: CLIENT_ID,
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        ...(scope ? { scope } : {}),
        subject_token: login.loginToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      },
      login.dpopKeyPair
    );
  }

  it("refuses bootstrap scopes the client did not register", async () => {
    await db
      .update(oauthClients)
      .set({ scopes: JSON.stringify(["openid", "email"]) })
      .where(eq(oauthClients.clientId, CLIENT_ID))
      .run();
    const login = await storeLoginToken(LOGIN_SCOPES);

    const { json, status } = await exchangeLogin(login, BOOTSTRAP_SCOPE);

    expect(status).toBe(400);
    expect(json).toMatchObject({
      error: "invalid_scope",
      error_description: "client does not allow scope agent:host.register",
    });
  });

  it("leaves bootstrap and offline_access scopes off an exchange that requests no scope", async () => {
    const login = await storeLoginToken([...LOGIN_SCOPES, "offline_access"]);

    const { json, status } = await exchangeLogin(login);

    expect(status).toBe(200);
    expect(json.scope).toBe("openid email");
    const stored = await findStoredOpaqueAccessToken(
      json.access_token as string
    );
    expect(stored?.scopes).toEqual(["openid", "email"]);
    expect(stored?.accessTokenClaims).not.toHaveProperty("zentity_token_use");
  });

  // Any client may bootstrap, but only within the scopes its login holds.
  it("refuses a bootstrap scope the login did not grant", async () => {
    const loginToken = "opaque-web-login-token";
    const dpopKeyPair = await createTestDpopKeyPair();
    const dpopJkt = await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256");

    await db
      .insert(oauthAccessTokens)
      .values({
        authContextId,
        clientId: WEB_CLIENT_ID,
        confirmation: JSON.stringify({ jkt: dpopJkt }),
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: JSON.stringify(["openid"]),
        token: hashOpaqueAccessToken(loginToken),
        userId,
      })
      .run();

    const { json, status } = await postTokenWithDpop(
      {
        audience: APP_URL,
        client_id: WEB_CLIENT_ID,
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        scope: BOOTSTRAP_SCOPE,
        subject_token: loginToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      },
      dpopKeyPair
    );

    expect({ status, json }).toEqual({
      status: 400,
      json: {
        error: "invalid_scope",
        error_description:
          "scope agent:host.register is not available through token exchange",
      },
    });
  });
});
