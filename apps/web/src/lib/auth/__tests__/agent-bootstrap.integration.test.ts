import crypto from "node:crypto";

import { calculateJwkThumbprint, decodeJwt, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/agent-identity";
import { createAuthenticationContext } from "@/lib/auth/authentication-context";
import { resolveSubForClient } from "@/lib/auth/oidc/pairwise";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import {
  oauthAccessTokens,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";
import {
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
      public: true,
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
      public: true,
      redirectUris: JSON.stringify([WEB_REDIRECT_URI]),
      subjectType: "pairwise",
      tokenEndpointAuthMethod: "none",
    })
    .run();
}

function buildResourceDpopProof(
  keyPair: DpopKeyPair,
  method: string,
  url: string,
  accessToken: string
): Promise<string> {
  const ath = crypto
    .createHash("sha256")
    .update(accessToken)
    .digest("base64url");
  return new SignJWT({
    ath,
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({
      alg: "ES256",
      jwk: keyPair.jwk,
      typ: "dpop+jwt",
    })
    .sign(keyPair.privateKey);
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

  it("exchanges an opaque pairwise login token into a bootstrap token accepted by register-host", async () => {
    const loginToken = "opaque-login-token";
    const dpopKeyPair = await createTestDpopKeyPair();
    const dpopJkt = await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256");

    await db
      .insert(oauthAccessTokens)
      .values({
        authContextId,
        clientId: CLIENT_ID,
        dpopJkt,
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: JSON.stringify(["openid"]),
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
    const payload = decodeJwt(bootstrapToken);
    expect(payload.aud).toBe(APP_URL);
    expect(payload.zentity_token_use).toBe(AGENT_BOOTSTRAP_TOKEN_USE);
    expect(payload.scope).toBe(BOOTSTRAP_SCOPE);
    expect(payload.zentity_login_hint).toBe(userId);
    expect(payload.sub).toBe(
      await resolveSubForClient(userId, {
        redirectUris: [REDIRECT_URI],
        subjectType: "pairwise",
      })
    );

    const registerUrl = `${APP_URL}/api/auth/agent/register-host`;
    const proof = await buildResourceDpopProof(
      dpopKeyPair,
      "POST",
      registerUrl,
      bootstrapToken
    );
    const { POST } = await import("@/app/api/auth/agent/register-host/route");
    const response = await POST(
      new Request(registerUrl, {
        method: "POST",
        headers: {
          Authorization: `DPoP ${bootstrapToken}`,
          "Content-Type": "application/json",
          DPoP: proof,
        },
        body: JSON.stringify({
          name: "Bootstrap Host",
          publicKey: JSON.stringify({
            crv: "Ed25519",
            kty: "OKP",
            x: "host-public-key",
          }),
        }),
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        created: true,
        hostId: expect.any(String),
      })
    );
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

    const { POST } = await import("@/app/api/auth/agent/register-host/route");
    const response = await POST(
      new Request(`${APP_URL}/api/auth/agent/register-host`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Bootstrap Host",
          publicKey: JSON.stringify({
            crv: "Ed25519",
            kty: "OKP",
            x: "host-public-key",
          }),
        }),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Bootstrap access token required",
    });
  });

  it("rejects bootstrap exchange for non-installed clients", async () => {
    const loginToken = "opaque-web-login-token";
    const dpopKeyPair = await createTestDpopKeyPair();
    const dpopJkt = await calculateJwkThumbprint(dpopKeyPair.jwk, "sha256");

    await db
      .insert(oauthAccessTokens)
      .values({
        authContextId,
        clientId: WEB_CLIENT_ID,
        dpopJkt,
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

    expect(status).toBe(400);
    expect(json).toEqual(
      expect.objectContaining({
        error: "invalid_scope",
      })
    );
  });
});
