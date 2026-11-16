import crypto from "node:crypto";

import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";
import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { calculateJwkThumbprint } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/session";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createAuthenticationContext,
} from "@/lib/auth/auth-context";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
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
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const CLIENT_ID = "pairwise-bootstrap-client";
const REDIRECT_URI = "http://localhost:3100/callback";
const BOOTSTRAP_SCOPE = "agent:host.register agent:session.register";
// The scopes an installed agent such as the MCP server signs in with: its
// ordinary session scopes plus the agent bootstrap scopes.
const SESSION_SCOPES = ["openid", "email", "proof:identity"];
const LOGIN_SCOPES = [
  ...SESSION_SCOPES,
  "offline_access",
  ...AGENT_BOOTSTRAP_SCOPES,
];
const HOST_DID = encodeEd25519DidKeyFromJwk({
  crv: "Ed25519",
  kty: "OKP",
  x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
});

function hashOpaqueAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

async function createInstalledAgentClient(scopes: string[] = LOGIN_SCOPES) {
  await db
    .insert(oauthClients)
    .values({
      clientId: CLIENT_ID,
      grantTypes: JSON.stringify([
        "authorization_code",
        "refresh_token",
        TOKEN_EXCHANGE_GRANT_TYPE,
      ]),
      name: "Pairwise Bootstrap Client",
      redirectUris: JSON.stringify([REDIRECT_URI]),
      scopes: JSON.stringify(scopes),
      subjectType: "pairwise",
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

function exchange(
  subjectToken: string,
  dpopKeyPair: DpopKeyPair,
  scope: string
) {
  return postTokenWithDpop(
    {
      audience: APP_URL,
      client_id: CLIENT_ID,
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      scope,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
    },
    dpopKeyPair
  );
}

async function registerHost(bootstrapToken: string, dpopKeyPair: DpopKeyPair) {
  const registerUrl = `${APP_URL}/api/auth/agent/host/register`;
  const proof = await buildDpopProof(
    dpopKeyPair,
    "POST",
    registerUrl,
    bootstrapToken
  );
  const { POST } = await import("@/app/api/auth/agent/host/register/route");
  return POST(
    new Request(registerUrl, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${bootstrapToken}`,
        "Content-Type": "application/json",
        DPoP: proof,
      },
      body: JSON.stringify({
        did: HOST_DID,
        name: "Bootstrap Host",
      }),
    })
  );
}

describe("agent bootstrap token exchange", () => {
  let authContextId: string;
  let userId: string;
  let dpopKeyPair: DpopKeyPair;
  let dpopJkt: string;

  /** Stores an opaque login token, as the authorization code grant issues one. */
  async function storeLoginToken(
    scopes: string[],
    { dpopBound = true }: { dpopBound?: boolean } = {}
  ): Promise<string> {
    const loginToken = `login-${crypto.randomUUID()}`;
    await db
      .insert(oauthAccessTokens)
      .values({
        accessTokenClaims: JSON.stringify({
          [AUTHENTICATION_CONTEXT_CLAIM]: authContextId,
        }),
        clientId: CLIENT_ID,
        confirmation: dpopBound ? JSON.stringify({ jkt: dpopJkt }) : null,
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: JSON.stringify(scopes),
        token: hashOpaqueAccessToken(loginToken),
        userId,
      })
      .run();
    return loginToken;
  }

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
    dpopKeyPair = await createTestDpopKeyPair();
    dpopJkt = await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256");
  });

  it("exchanges a login token granted the bootstrap scopes into a bootstrap token accepted by register-host", async () => {
    await createInstalledAgentClient();
    const loginToken = await storeLoginToken(LOGIN_SCOPES);

    const { json, status } = await exchange(
      loginToken,
      dpopKeyPair,
      BOOTSTRAP_SCOPE
    );

    expect(status).toBe(200);
    expect(json.token_type).toBe("DPoP");
    expect(json.scope).toBe(BOOTSTRAP_SCOPE);

    const bootstrapToken = json.access_token as string;
    const stored = await findStoredOpaqueAccessToken(bootstrapToken);
    expect(stored?.accessTokenClaims.zentity_token_use).toBe(
      AGENT_BOOTSTRAP_TOKEN_USE
    );
    expect(stored?.scopes.join(" ")).toBe(BOOTSTRAP_SCOPE);
    expect(stored?.userId).toBe(userId);
    expect(stored?.dpopJkt).toBe(dpopJkt);

    const response = await registerHost(bootstrapToken, dpopKeyPair);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        created: true,
        did: HOST_DID,
        hostId: expect.any(String),
      })
    );
  });

  it("refuses bootstrap scopes the login token was not granted", async () => {
    await createInstalledAgentClient();
    const loginToken = await storeLoginToken(["openid"]);

    const { json, status } = await exchange(
      loginToken,
      dpopKeyPair,
      BOOTSTRAP_SCOPE
    );

    expect(status).toBe(400);
    expect(json).toMatchObject({
      error: "invalid_scope",
      error_description:
        "Requested scope 'agent:host.register' exceeds subject token scope",
    });
  });

  it("refuses bootstrap scopes the client did not register", async () => {
    await createInstalledAgentClient(SESSION_SCOPES);
    const loginToken = await storeLoginToken(LOGIN_SCOPES);

    const { json, status } = await exchange(
      loginToken,
      dpopKeyPair,
      BOOTSTRAP_SCOPE
    );

    expect(status).toBe(400);
    expect(json).toMatchObject({
      error: "invalid_scope",
      error_description: "client does not allow scope agent:host.register",
    });
  });

  it("keeps bootstrap scopes off the session token and bootstraps from the login token", async () => {
    await createInstalledAgentClient();
    const loginToken = await storeLoginToken(LOGIN_SCOPES);

    const session = await exchange(
      loginToken,
      dpopKeyPair,
      SESSION_SCOPES.join(" ")
    );
    expect(session.status).toBe(200);
    expect(session.json.scope).toBe(SESSION_SCOPES.join(" "));
    const sessionToken = session.json.access_token as string;
    const storedSession = await findStoredOpaqueAccessToken(sessionToken);
    expect(storedSession?.scopes).toEqual(SESSION_SCOPES);
    expect(storedSession?.accessTokenClaims).not.toHaveProperty(
      "zentity_token_use"
    );

    // The session token cannot reach the agent registration endpoints, and
    // exchanging it cannot widen it to the bootstrap scopes.
    expect((await registerHost(sessionToken, dpopKeyPair)).status).toBe(401);
    const widened = await exchange(sessionToken, dpopKeyPair, BOOTSTRAP_SCOPE);
    expect(widened.status).toBe(400);
    expect(widened.json.error).toBe("invalid_scope");

    const bootstrap = await exchange(
      loginToken,
      dpopKeyPair,
      AGENT_BOOTSTRAP_SCOPES.join(" ")
    );
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.json.scope).toBe(AGENT_BOOTSTRAP_SCOPES.join(" "));
    expect(
      (await registerHost(bootstrap.json.access_token as string, dpopKeyPair))
        .status
    ).toBe(201);
  });

  it("leaves bootstrap and offline_access scopes off an exchange that requests no scope", async () => {
    await createInstalledAgentClient();
    const loginToken = await storeLoginToken(LOGIN_SCOPES);

    const { json, status } = await postTokenWithDpop(
      {
        audience: APP_URL,
        client_id: CLIENT_ID,
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        subject_token: loginToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
      },
      dpopKeyPair
    );

    expect(status).toBe(200);
    expect(json.scope).toBe(SESSION_SCOPES.join(" "));
    const stored = await findStoredOpaqueAccessToken(
      json.access_token as string
    );
    expect(stored?.scopes).toEqual(SESSION_SCOPES);
  });

  it("rejects direct opaque login tokens on bootstrap routes", async () => {
    await createInstalledAgentClient();
    const loginToken = await storeLoginToken(LOGIN_SCOPES, {
      dpopBound: false,
    });

    const { POST } = await import("@/app/api/auth/agent/host/register/route");
    const response = await POST(
      new Request(`${APP_URL}/api/auth/agent/host/register`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          did: HOST_DID,
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
});
