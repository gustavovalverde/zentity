import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth/auth-config";
import { verifyIssuedAccessToken } from "@/lib/auth/jwt";
import {
  loadOpaqueAccessToken,
  mintOpaqueAccessToken,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import { db } from "@/lib/db/connection";
import { verifications } from "@/lib/db/schema/auth";
import {
  oauthClients,
  oauthRefreshTokens,
} from "@/lib/db/schema/oauth-provider";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";
import {
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const AUTH_URL = "http://localhost:3000/api/auth";
const REDIRECT_URI = "http://127.0.0.1/callback";
const RESOURCE = "http://localhost:3000";
const OWNER = { id: "revoke-owner", secret: "owner-secret-value" };
const OTHER = { id: "revoke-other", secret: "other-secret-value" };
const PUBLIC_CLIENT = "revoke-public";

interface IssuedTokens {
  accessToken: string;
  dpopKeyPair: DpopKeyPair;
  refreshToken: string;
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("base64url");
}

async function registerClient(clientId: string, secret?: string) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      clientSecret: secret ? hashSecret(secret) : null,
      name: clientId,
      scopes: JSON.stringify(["openid", "email", "offline_access"]),
      grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
      redirectUris: JSON.stringify([REDIRECT_URI]),
      responseTypes: JSON.stringify(["code"]),
      tokenEndpointAuthMethod: secret ? "client_secret_post" : "none",
    })
    .run();
}

function credentialsFor(clientId: string): Record<string, string> {
  if (clientId === OWNER.id) {
    return { client_id: OWNER.id, client_secret: OWNER.secret };
  }
  if (clientId === OTHER.id) {
    return { client_id: OTHER.id, client_secret: OTHER.secret };
  }
  return { client_id: clientId };
}

async function issueTokens(
  userId: string,
  sessionId: string,
  clientId: string
): Promise<IssuedTokens> {
  const code = crypto.randomUUID();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const now = Date.now();
  await db
    .insert(verifications)
    .values({
      id: crypto.randomUUID(),
      identifier: crypto.createHash("sha256").update(code).digest("base64url"),
      value: JSON.stringify({
        type: "authorization_code",
        query: {
          client_id: clientId,
          response_type: "code",
          redirect_uri: REDIRECT_URI,
          scope: "openid email offline_access",
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource: RESOURCE,
        },
        userId,
        sessionId,
      }),
      createdAt: new Date(now),
      updatedAt: new Date(now),
      expiresAt: new Date(now + 5 * 60 * 1000),
    })
    .run();

  const { status, json, dpopKeyPair } = await postTokenWithDpop({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    ...credentialsFor(clientId),
  });
  if (status !== 200) {
    throw new Error(`token request failed: ${JSON.stringify(json)}`);
  }
  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string,
    dpopKeyPair,
  };
}

async function revoke(
  body: Record<string, string>,
  authorization?: string
): Promise<{ body: Record<string, unknown>; status: number }> {
  const response = await auth.handler(
    new Request(`${AUTH_URL}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(authorization ? { authorization } : {}),
      },
      body: new URLSearchParams(body),
    })
  );
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  return {
    status: response.status,
    body:
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {},
  };
}

async function userInfoStatus(
  accessToken: string,
  keyPair: DpopKeyPair
): Promise<number> {
  const url = `${AUTH_URL}/oauth2/userinfo`;
  const response = await auth.handler(
    new Request(url, {
      method: "GET",
      headers: {
        authorization: `DPoP ${accessToken}`,
        DPoP: await buildDpopProof(keyPair, "GET", url, accessToken),
      },
    })
  );
  await response.text();
  return response.status;
}

async function introspectionActive(token: string): Promise<unknown> {
  const response = await auth.handler(
    new Request(`${AUTH_URL}/oauth2/introspect`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, ...credentialsFor(OWNER.id) }),
    })
  );
  return ((await response.json()) as { active?: unknown }).active;
}

async function refreshStatus(
  tokens: IssuedTokens,
  clientId: string
): Promise<number> {
  const { status } = await postTokenWithDpop(
    {
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      resource: RESOURCE,
      ...credentialsFor(clientId),
    },
    tokens.dpopKeyPair
  );
  return status;
}

async function revokedJtis(): Promise<string[]> {
  const rows = await db.select({ jti: revokedTokens.jti }).from(revokedTokens);
  return rows.map((row) => row.jti);
}

describe("RFC 7009 token revocation", () => {
  let userId: string;
  let sessionId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser({ emailVerified: true });
    ({ sessionId } = await createTestSession(userId));
    await registerClient(OWNER.id, OWNER.secret);
    await registerClient(OTHER.id, OTHER.secret);
    await registerClient(PUBLIC_CLIENT);

    const { GET: serveJwks } = await import("@/app/api/auth/oauth2/jwks/route");
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      String(input instanceof Request ? input.url : input).endsWith(
        "/oauth2/jwks"
      )
        ? serveJwks()
        : realFetch(input, init)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a confidential client that does not authenticate", async () => {
    const tokens = await issueTokens(userId, sessionId, OWNER.id);

    const basic = (secret: string) =>
      `Basic ${Buffer.from(`${OWNER.id}:${secret}`).toString("base64")}`;
    for (const token of [tokens.accessToken, tokens.refreshToken]) {
      for (const [credentials, authorization, status] of [
        [{}, undefined, 401],
        [{}, basic("wrong-secret"), 401],
        [{ client_id: OWNER.id }, undefined, 400],
        [{ client_id: OWNER.id, client_secret: "wrong" }, undefined, 400],
      ] as const) {
        const result = await revoke({ token, ...credentials }, authorization);
        expect(result).toMatchObject({
          status,
          body: { error: "invalid_client" },
        });
      }
    }
    expect(await revokedJtis()).toEqual([]);
    expect(await userInfoStatus(tokens.accessToken, tokens.dpopKeyPair)).toBe(
      200
    );
    expect(await refreshStatus(tokens, OWNER.id)).toBe(200);
  });

  it("does not let another client revoke a token it was not issued", async () => {
    const tokens = await issueTokens(userId, sessionId, OWNER.id);

    for (const token of [tokens.accessToken, tokens.refreshToken]) {
      const result = await revoke({ token, ...credentialsFor(OTHER.id) });
      expect(result.status).toBe(200);
    }

    expect(await revokedJtis()).toEqual([]);
    expect(await userInfoStatus(tokens.accessToken, tokens.dpopKeyPair)).toBe(
      200
    );
    expect(await verifyIssuedAccessToken(tokens.accessToken)).not.toBeNull();
    expect(await refreshStatus(tokens, OWNER.id)).toBe(200);
  });

  it("does not record a forged JWT that reuses a real token's jti", async () => {
    const tokens = await issueTokens(userId, sessionId, OWNER.id);
    const { jti } = decodeJwt(tokens.accessToken);
    const forged = await new SignJWT({
      jti,
      azp: OWNER.id,
      client_id: OWNER.id,
    })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .sign(new TextEncoder().encode("attacker-controlled-key-material!"));

    const result = await revoke({ token: forged, ...credentialsFor(OWNER.id) });

    expect(result.status).toBe(200);
    expect(await revokedJtis()).toEqual([]);
    expect(await verifyIssuedAccessToken(tokens.accessToken)).not.toBeNull();
  });

  it("revokes the owner's JWT access token", async () => {
    const tokens = await issueTokens(userId, sessionId, OWNER.id);
    expect(tokens.accessToken.split(".")).toHaveLength(3);
    expect(await introspectionActive(tokens.accessToken)).toBe(true);

    const result = await revoke({
      token: tokens.accessToken,
      token_type_hint: "access_token",
      ...credentialsFor(OWNER.id),
    });

    expect(result.status).toBe(200);
    expect(await revokedJtis()).toEqual([decodeJwt(tokens.accessToken).jti]);
    expect(await userInfoStatus(tokens.accessToken, tokens.dpopKeyPair)).toBe(
      401
    );
    expect(await introspectionActive(tokens.accessToken)).toBe(false);
    expect(await verifyIssuedAccessToken(tokens.accessToken)).toBeNull();
  });

  it("revokes the owner's refresh token", async () => {
    const tokens = await issueTokens(userId, sessionId, OWNER.id);

    const result = await revoke({
      token: tokens.refreshToken,
      token_type_hint: "refresh_token",
      ...credentialsFor(OWNER.id),
    });

    expect(result.status).toBe(200);
    const [row] = await db
      .select({ revoked: oauthRefreshTokens.revoked })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.clientId, OWNER.id))
      .all();
    expect(row?.revoked).toBeInstanceOf(Date);
    expect(await refreshStatus(tokens, OWNER.id)).toBe(400);
  });

  it("revokes the owner's opaque access token", async () => {
    const token = await mintOpaqueAccessToken({
      clientId: OWNER.id,
      exchangeClaims: {},
      expiresAt: new Date(Date.now() + 3_600_000),
      referenceId: crypto.randomUUID(),
      scopes: ["openid"],
      sessionId,
      userId,
    });

    const denied = await revoke({ token, ...credentialsFor(OTHER.id) });
    expect(denied.status).toBe(200);
    expect(await loadOpaqueAccessToken(token)).not.toBeNull();

    const result = await revoke({ token, ...credentialsFor(OWNER.id) });
    expect(result.status).toBe(200);
    expect(await loadOpaqueAccessToken(token)).toBeNull();
  });

  it("lets a public client revoke its own token with its client_id", async () => {
    const tokens = await issueTokens(userId, sessionId, PUBLIC_CLIENT);

    const result = await revoke({
      token: tokens.accessToken,
      client_id: PUBLIC_CLIENT,
    });

    expect(result.status).toBe(200);
    expect(await revokedJtis()).toEqual([decodeJwt(tokens.accessToken).jti]);
    expect(await userInfoStatus(tokens.accessToken, tokens.dpopKeyPair)).toBe(
      401
    );
  });
});
