import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WALLET_AUDIENCE = vi.hoisted(() => {
  process.env.WALLET_AUDIENCE = "urn:zentity:wallet:token-exchange-test";
  return process.env.WALLET_AUDIENCE;
});

import { POST as registerClient } from "@/app/api/auth/oauth2/register/route";
import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { AUTHENTICATION_CONTEXT_CLAIM } from "@/lib/auth/auth-context";
import { encryptPrivateKey } from "@/lib/auth/oidc/jwt-signer";
import { resolveSubForClientId } from "@/lib/auth/oidc/pairwise";
import { introspectZentityAccessToken } from "@/lib/auth/oidc/resource-principal";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { agentTokenSnapshots } from "@/lib/db/schema/agent";
import { sessions } from "@/lib/db/schema/auth";
import {
  jwks as jwksTable,
  oauthAccessTokens,
  oauthClientResources,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { redeemTestAuthorizationCode } from "@/test-utils/authorization-code-test-utils";
import {
  createTestCibaRequest,
  createTestSession,
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

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const AUTH_URL = "http://localhost:3000/api/auth";
const authIssuer = getAuthIssuer();
const APP_AUDIENCE = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
const MCP_AUDIENCE = env.MCP_PUBLIC_URL;
const LOOPBACK_REDIRECT = "http://127.0.0.1/callback";
const BOOTSTRAP_SCOPE =
  "agent:host.register agent:session.register agent:session.revoke";

// The installed agent: a public loopback client that signs the user in and
// exchanges its own login token.
const AGENT_ID = "exchange-agent";
// A remote MCP host: a public client whose tokens are audienced to MCP.
const REMOTE_HOST_ID = "exchange-remote-host";
// The MCP HTTP server: a confidential client linked to the MCP resource.
const MCP_ID = "exchange-mcp-server";
const MCP_SECRET = "exchange-mcp-secret";
const MCP_SCOPES = [
  "openid",
  "email",
  "compliance:read",
  "proof:identity",
  "identity.name",
  "identity.dob",
  "identity.address",
  "proof:age",
  "proof:nationality",
  "poh",
];

const invalidRequest = (description: string) => ({
  error: "invalid_request",
  error_description: description,
});
const INVALID_SUBJECT = invalidRequest("subject_token is invalid");
const DELEGATED_SUBJECT = invalidRequest(
  "subject_token must not be a delegated token"
);
const INVALID_TARGET = {
  error: "invalid_target",
  error_description: "each resource or audience must be a registered resource",
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function basicAuth(clientId: string, secret: string) {
  const encoded = Buffer.from(
    `${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`
  ).toString("base64");
  return { authorization: `Basic ${encoded}` };
}

async function insertClient(
  clientId: string,
  values: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      redirectUris: JSON.stringify([LOOPBACK_REDIRECT]),
      grantTypes: JSON.stringify([
        "authorization_code",
        "refresh_token",
        TOKEN_EXCHANGE_GRANT_TYPE,
        CIBA_GRANT_TYPE,
      ]),
      responseTypes: JSON.stringify(["code"]),
      tokenEndpointAuthMethod: "none",
      subjectType: "pairwise",
      sectorIdentifier: `client/${clientId}`,
      metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
      ...values,
    })
    .run();
}

/** A confidential resource server for MCP, as `mcp:provision` creates it. */
async function insertResourceServer(
  clientId: string,
  options: { linked: boolean; skipConsent: boolean }
) {
  await insertClient(clientId, {
    clientSecret: hashToken(MCP_SECRET),
    tokenEndpointAuthMethod: "client_secret_basic",
    redirectUris: JSON.stringify([]),
    responseTypes: JSON.stringify([]),
    grantTypes: JSON.stringify([TOKEN_EXCHANGE_GRANT_TYPE, CIBA_GRANT_TYPE]),
    scopes: JSON.stringify(MCP_SCOPES),
    skipConsent: options.skipConsent,
  });
  if (options.linked) {
    await db
      .insert(oauthClientResources)
      .values({
        id: crypto.randomUUID(),
        clientId,
        resourceId: MCP_AUDIENCE,
      })
      .run();
  }
}

/** An exchange by the agent, or by the client `options.headers` authenticates. */
function exchange(
  body: Record<string, string>,
  options: { headers?: Record<string, string>; keyPair?: DpopKeyPair } = {}
) {
  return postTokenWithDpop(
    {
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token_type: ACCESS_TOKEN_TYPE,
      audience: APP_AUDIENCE,
      ...(options.headers ? {} : { client_id: AGENT_ID }),
      ...body,
    },
    options.keyPair,
    options.headers
  );
}

function exchangeAsMcp(
  subjectToken: string,
  body: Record<string, string> = {},
  clientId = MCP_ID
) {
  return exchange(
    { subject_token: subjectToken, ...body },
    { headers: basicAuth(clientId, MCP_SECRET) }
  );
}

let signingKey: Awaited<ReturnType<typeof generateKeyPair>> | undefined;
const signingKid = crypto.randomUUID();

// One key for the whole file: the provider caches the JWKS and refetches it
// for an unknown kid at most every 30 seconds, as for real key rotation.
async function ensureSigningKey() {
  if (!signingKey) {
    signingKey = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
  }
  await db
    .insert(jwksTable)
    .values({
      id: signingKid,
      publicKey: JSON.stringify(await exportJWK(signingKey.publicKey)),
      privateKey: encryptPrivateKey(
        JSON.stringify(await exportJWK(signingKey.privateKey))
      ),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .onConflictDoNothing()
    .run();
}

/** A JWT access token with claims the provider's own flows do not produce. */
async function signAccessToken(claims: Record<string, unknown>) {
  await ensureSigningKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: authIssuer,
    aud: MCP_AUDIENCE,
    azp: AGENT_ID,
    client_id: AGENT_ID,
    scope: "openid",
    iat: now,
    exp: now + 3600,
    jti: crypto.randomUUID(),
    ...claims,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: signingKid })
    .sign(signingKey?.privateKey as CryptoKey);
}

/** An opaque login token as the provider stores it, bound to `dpopKeyPair`. */
async function insertOpaqueToken(input: {
  accessTokenClaims?: Record<string, unknown>;
  authContextId?: string | null;
  clientId?: string;
  dpopKeyPair?: DpopKeyPair;
  expiresAt?: Date;
  referenceId?: string;
  scopes: string;
  sessionId?: string | null;
  userId: string;
}) {
  const token = `opaque-${crypto.randomUUID()}`;
  const accessTokenClaims = {
    ...input.accessTokenClaims,
    ...(input.authContextId
      ? { [AUTHENTICATION_CONTEXT_CLAIM]: input.authContextId }
      : {}),
  };
  await db
    .insert(oauthAccessTokens)
    .values({
      token: hashToken(token),
      clientId: input.clientId ?? AGENT_ID,
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      referenceId: input.referenceId ?? crypto.randomUUID(),
      scopes: JSON.stringify(input.scopes.split(" ")),
      expiresAt: input.expiresAt ?? new Date(Date.now() + 3_600_000),
      confirmation: input.dpopKeyPair
        ? JSON.stringify({ jkt: await jwkThumbprint(input.dpopKeyPair) })
        : null,
      accessTokenClaims:
        Object.keys(accessTokenClaims).length > 0
          ? JSON.stringify(accessTokenClaims)
          : null,
    })
    .run();
  return token;
}

async function jwkThumbprint(keyPair: DpopKeyPair): Promise<string> {
  const { calculateJwkThumbprint } = await import("jose");
  return calculateJwkThumbprint(keyPair.jwk, "sha256");
}

describe("Token Exchange (RFC 8693)", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await insertClient(AGENT_ID, {
      scopes: JSON.stringify([
        "openid",
        "email",
        "compliance:read",
        "offline_access",
        ...BOOTSTRAP_SCOPE.split(" "),
      ]),
    });
    await insertClient(REMOTE_HOST_ID);
    await insertResourceServer(MCP_ID, { linked: true, skipConsent: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The agent's own DPoP-bound, session-bound login token. */
  async function agentLogin(scope = `openid ${BOOTSTRAP_SCOPE}`) {
    const { status, json, dpopKeyPair, session } =
      await redeemTestAuthorizationCode({
        clientId: AGENT_ID,
        redirectUri: LOOPBACK_REDIRECT,
        userId,
        scope,
      });
    if (status !== 200) {
      throw new Error(`login failed: ${JSON.stringify(json)}`);
    }
    return { token: json.access_token as string, dpopKeyPair, session };
  }

  /** A remote host's JWT for the MCP server, as an MCP client receives it. */
  async function remoteHostToken(
    scope = "openid compliance:read offline_access"
  ) {
    const { status, json, dpopKeyPair, session } =
      await redeemTestAuthorizationCode({
        clientId: REMOTE_HOST_ID,
        redirectUri: LOOPBACK_REDIRECT,
        userId,
        scope,
        resource: MCP_AUDIENCE,
      });
    if (status !== 200) {
      throw new Error(`remote host login failed: ${JSON.stringify(json)}`);
    }
    return {
      token: json.access_token as string,
      refreshToken: json.refresh_token as string,
      dpopKeyPair,
      session,
    };
  }

  describe("bootstrap self-exchange", () => {
    it("mints an opaque bootstrap token for the app, bound to the login key", async () => {
      const login = await agentLogin();

      const { status, json } = await exchange(
        { subject_token: login.token, scope: BOOTSTRAP_SCOPE },
        { keyPair: login.dpopKeyPair }
      );

      expect(status).toBe(200);
      expect(json).toEqual({
        access_token: expect.any(String),
        issued_token_type: ACCESS_TOKEN_TYPE,
        token_type: "DPoP",
        expires_in: expect.any(Number),
        scope: BOOTSTRAP_SCOPE,
      });
      const token = json.access_token as string;
      expect(token.split(".")).toHaveLength(1);
      const stored = await findStoredOpaqueAccessToken(token);
      expect(stored).toMatchObject({
        act: null,
        accessTokenClaims: { zentity_token_use: "agent_bootstrap" },
        dpopJkt: await jwkThumbprint(login.dpopKeyPair),
        userId,
      });

      // The provider validates the minted row and returns the marker with it.
      const { payload } = await introspectZentityAccessToken(token);
      expect(payload).toMatchObject({
        active: true,
        sub: userId,
        client_id: AGENT_ID,
        sid: login.session.sessionId,
        zentity_token_use: "agent_bootstrap",
      });
      expect(payload.act).toBeUndefined();
    });

    it("refuses a proof by a key other than the login token's", async () => {
      const login = await agentLogin();

      const { status, json } = await exchange({
        subject_token: login.token,
        scope: BOOTSTRAP_SCOPE,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_dpop_proof");
    });

    // R12: an installed client no longer widens a loopback login.
    it("refuses a bootstrap scope the login token does not hold", async () => {
      const login = await agentLogin("openid compliance:read");

      const { status, json } = await exchange(
        { subject_token: login.token, scope: "agent:host.register" },
        { keyPair: login.dpopKeyPair }
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

    it("inherits no bootstrap scope when the request names no scope", async () => {
      const login = await agentLogin(
        `openid compliance:read ${BOOTSTRAP_SCOPE}`
      );

      const { status, json } = await exchange(
        { subject_token: login.token },
        { keyPair: login.dpopKeyPair }
      );

      expect(status).toBe(200);
      expect(json.scope).toBe("openid compliance:read");
      const { payload } = await introspectZentityAccessToken(
        json.access_token as string
      );
      expect(payload.active).toBe(true);
      expect(payload.zentity_token_use).toBeUndefined();
    });

    it("refuses an exchange that would inherit no scope", async () => {
      const login = await agentLogin(BOOTSTRAP_SCOPE);

      const { status, json } = await exchange(
        { subject_token: login.token },
        { keyPair: login.dpopKeyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: {
          error: "invalid_scope",
          error_description:
            "Subject token has no scope this client can exchange",
        },
      });
    });

    it("refuses bootstrap scopes mixed with other scopes", async () => {
      const login = await agentLogin(
        `openid compliance:read ${BOOTSTRAP_SCOPE}`
      );

      const { status, json } = await exchange(
        {
          subject_token: login.token,
          scope: "agent:host.register compliance:read",
        },
        { keyPair: login.dpopKeyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: {
          error: "invalid_scope",
          error_description:
            "Bootstrap token exchanges may only request agent bootstrap scopes",
        },
      });
    });
  });

  describe("resource server exchange", () => {
    it("lets the linked MCP client exchange a remote host's token, bound to its own key", async () => {
      const remote = await remoteHostToken();

      const { status, json, dpopKeyPair } = await exchangeAsMcp(remote.token);

      expect(status).toBe(200);
      // R7, R8, R15: offline_access never carries over, openid stays.
      expect(json.scope).toBe("openid compliance:read");
      expect(json).not.toHaveProperty("refresh_token");
      const stored = await findStoredOpaqueAccessToken(
        json.access_token as string
      );
      expect(stored).toMatchObject({
        act: null,
        accessTokenClaims: {},
        clientId: MCP_ID,
        dpopJkt: await jwkThumbprint(dpopKeyPair),
        userId,
      });
      expect(await db.select().from(agentTokenSnapshots).all()).toEqual([]);
    });

    // R26: the MCP server's subject is its own pairwise subject.
    it("gives the MCP client a pairwise subject at UserInfo that works as its CIBA login hint", async () => {
      const remote = await remoteHostToken();
      const exchanged = await exchangeAsMcp(remote.token);
      const accessToken = exchanged.json.access_token as string;
      const userInfoUrl = `${authIssuer}/oauth2/userinfo`;

      const userInfo = await auth.handler(
        new Request(userInfoUrl, {
          headers: {
            authorization: `DPoP ${accessToken}`,
            DPoP: await buildDpopProof(
              exchanged.dpopKeyPair,
              "GET",
              userInfoUrl,
              accessToken
            ),
          },
        })
      );
      const { sub } = (await userInfo.json()) as { sub: string };
      expect(userInfo.status).toBe(200);
      expect(sub).not.toBe(userId);
      expect(sub).toBe(await resolveSubForClientId(userId, MCP_ID));

      const backchannel = await auth.handler(
        new Request(`${AUTH_URL}/oauth2/bc-authorize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...basicAuth(MCP_ID, MCP_SECRET),
          },
          body: new URLSearchParams({
            scope: "openid identity.name",
            login_hint: sub,
            binding_message: "Read your name",
          }),
        })
      );
      expect(backchannel.status).toBe(200);
    });

    // R6: a public client cannot claim to be the resource server, whatever
    // it registered.
    it("refuses a public client presenting another client's token", async () => {
      const remote = await remoteHostToken();
      const registration = await registerClient(
        new Request(`${AUTH_URL}/oauth2/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: "Claims To Be MCP",
            redirect_uris: [LOOPBACK_REDIRECT],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", TOKEN_EXCHANGE_GRANT_TYPE],
            response_types: ["code"],
            zentity_protected_resource: MCP_AUDIENCE,
          }),
        })
      );
      const { client_id: clientId } = (await registration.json()) as {
        client_id: string;
      };

      const { status, json } = await exchange({
        client_id: clientId,
        subject_token: remote.token,
      });

      expect({ status, json }).toEqual({ status: 400, json: INVALID_SUBJECT });
    });

    it("refuses a confidential client the MCP resource is not linked to", async () => {
      await insertResourceServer("unlinked-server", {
        linked: false,
        skipConsent: true,
      });
      const remote = await remoteHostToken();

      const { status, json } = await exchangeAsMcp(
        remote.token,
        {},
        "unlinked-server"
      );

      expect({ status, json }).toEqual({ status: 400, json: INVALID_SUBJECT });
    });

    it("refuses a linked resource server that does not skip consent", async () => {
      await insertResourceServer("consenting-server", {
        linked: true,
        skipConsent: false,
      });
      const remote = await remoteHostToken();

      const { status, json } = await exchangeAsMcp(
        remote.token,
        {},
        "consenting-server"
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest(
          "the user has not consented to this client for this exchange"
        ),
      });
    });

    it("refuses a confidential client that sends no secret", async () => {
      const remote = await remoteHostToken();

      const { status, json } = await exchange({
        client_id: MCP_ID,
        subject_token: remote.token,
      });

      expect({ status, json }).toEqual({
        status: 400,
        // The provider refuses the authentication method before the secret.
        json: {
          error: "invalid_client",
          error_description:
            "client registered for client_secret_basic cannot use none",
        },
      });
    });

    // R7: exchanged scopes stay within the client's registration.
    it("refuses an explicit scope the client did not register", async () => {
      const remote = await remoteHostToken(
        "openid compliance:read proof:sybil"
      );

      const { status, json } = await exchangeAsMcp(remote.token, {
        scope: "openid proof:sybil",
      });

      expect({ status, json }).toEqual({
        status: 400,
        json: {
          error: "invalid_scope",
          error_description: "client does not allow scope proof:sybil",
        },
      });
    });

    it("drops a defaulted scope the client did not register", async () => {
      const remote = await remoteHostToken(
        "openid compliance:read proof:sybil"
      );

      const { status, json } = await exchangeAsMcp(remote.token);

      expect(status).toBe(200);
      expect(json.scope).toBe("openid compliance:read");
    });

    it("refuses an explicit offline_access", async () => {
      const remote = await remoteHostToken();

      const { status, json } = await exchangeAsMcp(remote.token, {
        scope: "openid offline_access",
      });

      expect({ status, json }).toEqual({
        status: 400,
        json: {
          error: "invalid_scope",
          error_description:
            "scope offline_access is not available through token exchange",
        },
      });
    });

    // R5: nothing about an agent crosses to the exchanged token.
    it("introspects the exchanged token without actor or agent claims", async () => {
      const remote = await remoteHostToken();
      const exchanged = await exchangeAsMcp(remote.token);

      const { payload } = await introspectZentityAccessToken(
        exchanged.json.access_token as string
      );

      expect(payload.active).toBe(true);
      for (const claim of ["act", "session_id", "host_id", "did", "audit"]) {
        expect(payload).not.toHaveProperty(claim);
      }
    });

    // R20: ending the session ends the exchanged token.
    it("ends the exchanged token with the session it derives from", async () => {
      const remote = await remoteHostToken();
      const exchanged = await exchangeAsMcp(remote.token);
      const accessToken = exchanged.json.access_token as string;

      await db
        .delete(sessions)
        .where(eq(sessions.id, remote.session.sessionId))
        .run();

      const { payload } = await introspectZentityAccessToken(accessToken);
      expect(payload).toEqual({ active: false });
      const userInfoUrl = `${authIssuer}/oauth2/userinfo`;
      const userInfo = await auth.handler(
        new Request(userInfoUrl, {
          headers: {
            authorization: `DPoP ${accessToken}`,
            DPoP: await buildDpopProof(
              exchanged.dpopKeyPair,
              "GET",
              userInfoUrl,
              accessToken
            ),
          },
        })
      );
      expect(userInfo.status).toBe(401);
    });

    // R19 as built: a remote host's grant ends with the browser session. Its
    // offline_access refresh token survives sign-out, but an `openid` refresh
    // has no authentication context for the ID token, and any access token a
    // refresh yields carries the ended `sid`, which the provider treats as
    // revoked.
    it("refuses a remote host's token, and refreshes it, once its browser session ends", async () => {
      const remote = await remoteHostToken();
      const withoutOpenid = await remoteHostToken(
        "compliance:read offline_access"
      );
      for (const { session } of [remote, withoutOpenid]) {
        await db
          .delete(sessions)
          .where(eq(sessions.id, session.sessionId))
          .run();
      }
      const refresh = (grant: typeof remote) =>
        postTokenWithDpop(
          {
            grant_type: "refresh_token",
            refresh_token: grant.refreshToken,
            client_id: REMOTE_HOST_ID,
          },
          grant.dpopKeyPair
        );

      const direct = await exchangeAsMcp(remote.token);
      const openidRefresh = await refresh(remote);
      const scopedRefresh = await refresh(withoutOpenid);
      const refreshedToken = scopedRefresh.json.access_token as string;
      const fromRefresh = await exchangeAsMcp(refreshedToken);

      expect(direct).toMatchObject({ status: 400, json: INVALID_SUBJECT });
      expect(openidRefresh).toMatchObject({
        status: 400,
        json: {
          error: "invalid_grant",
          error_description:
            "Authentication context required for ID token issuance",
        },
      });
      expect(scopedRefresh.status).toBe(200);
      expect(decodeJwt(refreshedToken).sid).toBe(
        withoutOpenid.session.sessionId
      );
      expect(fromRefresh).toMatchObject({ status: 400, json: INVALID_SUBJECT });
    });

    // D24: no context is read from the refresh row or a claim, so a JWT
    // without `sid` has none.
    it("refuses a JWT subject without a session", async () => {
      const subject = await signAccessToken({
        sub: userId,
        azp: REMOTE_HOST_ID,
        client_id: REMOTE_HOST_ID,
        scope: "openid compliance:read",
        reference_id: crypto.randomUUID(),
      });

      const { status, json } = await exchangeAsMcp(subject);

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest("subject_token has no authentication context"),
      });
    });
  });

  describe("subjects the grant refuses", () => {
    // R1: RFC 9396 details never cross an exchange.
    it("refuses a JWT subject that carries authorization_details", async () => {
      const subject = await signAccessToken({
        sub: userId,
        aud: WALLET_AUDIENCE,
        authorization_details: [{ type: "payment_authorization" }],
      });

      const { status, json } = await exchange({ subject_token: subject });

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest(
          "subject_token must not carry authorization_details"
        ),
      });
    });

    it("refuses an opaque subject whose stored claims carry authorization_details", async () => {
      const keyPair = await createTestDpopKeyPair();
      const { sessionId, authContextId } = await createTestSession(userId);
      const subject = await insertOpaqueToken({
        userId,
        scopes: "openid",
        sessionId,
        authContextId,
        dpopKeyPair: keyPair,
        accessTokenClaims: {
          authorization_details: [{ type: "x402_purchase" }],
        },
      });

      const { status, json } = await exchange(
        { subject_token: subject },
        { keyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest(
          "subject_token must not carry authorization_details"
        ),
      });
    });

    // R4, R11: agent and CIBA tokens are delegated.
    it("refuses a CIBA token", async () => {
      const { authReqId } = await createTestCibaRequest({
        clientId: AGENT_ID,
        userId,
        status: "approved",
      });
      const poll = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: AGENT_ID,
      });
      expect(poll.status).toBe(200);

      const { status, json } = await exchange(
        { subject_token: poll.json.access_token as string },
        { keyPair: poll.dpopKeyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: DELEGATED_SUBJECT,
      });
    });

    // R30: the approval record refuses a CIBA token even without its actor.
    it("refuses a CIBA token whose stored actor was removed", async () => {
      const { authReqId, authReqIdHash } = await createTestCibaRequest({
        clientId: AGENT_ID,
        userId,
        status: "approved",
      });
      const poll = await postTokenWithDpop({
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: AGENT_ID,
      });
      await db
        .update(oauthAccessTokens)
        .set({ act: null })
        .where(eq(oauthAccessTokens.referenceId, authReqIdHash))
        .run();
      const { payload } = await introspectZentityAccessToken(
        poll.json.access_token as string
      );
      expect(payload.act).toBeUndefined();

      const { status, json } = await exchange(
        { subject_token: poll.json.access_token as string },
        { keyPair: poll.dpopKeyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: DELEGATED_SUBJECT,
      });
    });

    it("refuses a JWT subject with an actor", async () => {
      const subject = await signAccessToken({
        sub: userId,
        act: { sub: "agent-session", sub_profile: "service" },
      });

      const { status, json } = await exchange({ subject_token: subject });

      expect({ status, json }).toEqual({
        status: 400,
        json: DELEGATED_SUBJECT,
      });
    });

    it("refuses a public client's subject that is not DPoP-bound", async () => {
      const { sessionId, authContextId } = await createTestSession(userId);
      const subject = await insertOpaqueToken({
        userId,
        scopes: "openid",
        sessionId,
        authContextId,
      });

      const { status, json } = await exchange({ subject_token: subject });

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest(
          "a public client may only exchange a DPoP-bound subject_token"
        ),
      });
    });

    // R18: no exchanged token without the authentication behind it.
    it("refuses a subject with no authentication context", async () => {
      const keyPair = await createTestDpopKeyPair();
      const subject = await insertOpaqueToken({
        userId,
        scopes: "openid",
        dpopKeyPair: keyPair,
      });

      const { status, json } = await exchange(
        { subject_token: subject },
        { keyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest("subject_token has no authentication context"),
      });
    });

    it("refuses an unknown subject token", async () => {
      const { status, json } = await exchange({
        subject_token: "not-a-token",
      });

      expect({ status, json }).toEqual({ status: 400, json: INVALID_SUBJECT });
    });

    // R14: the exchanged token never outlives its subject.
    it("caps the lifetime at the subject's expiry", async () => {
      const keyPair = await createTestDpopKeyPair();
      const { sessionId, authContextId } = await createTestSession(userId);
      const subject = await insertOpaqueToken({
        userId,
        scopes: "openid",
        sessionId,
        authContextId,
        dpopKeyPair: keyPair,
        expiresAt: new Date(Date.now() + 600_000),
      });

      const { status, json } = await exchange(
        { subject_token: subject },
        { keyPair }
      );

      expect(status).toBe(200);
      expect(json.expires_in).toBeLessThanOrEqual(600);
    });

    it("refuses a subject that expires before issuance", async () => {
      // The subject is still active within its last second, but its `exp`
      // (whole seconds) leaves nothing to issue.
      const now = new Date("2026-11-16T12:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"], now });
      const keyPair = await createTestDpopKeyPair();
      const { sessionId, authContextId } = await createTestSession(userId);
      const subject = await insertOpaqueToken({
        userId,
        scopes: "openid",
        sessionId,
        authContextId,
        dpopKeyPair: keyPair,
        expiresAt: new Date(now.getTime() + 900),
      });

      const { status, json } = await exchange(
        { subject_token: subject },
        { keyPair }
      );

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest("the token this grant derives from has expired"),
      });
    });
  });

  describe("request parameters", () => {
    // R10: ID tokens are neither input nor output.
    it.each([
      [
        "an id_token subject",
        { subject_token_type: ID_TOKEN_TYPE },
        `subject_token_type must be ${ACCESS_TOKEN_TYPE}`,
      ],
      [
        "an id_token output",
        { requested_token_type: ID_TOKEN_TYPE },
        "requested_token_type is not supported",
      ],
      // R23: actor tokens are refused, not ignored.
      [
        "an actor_token",
        { actor_token: "actor", actor_token_type: ACCESS_TOKEN_TYPE },
        "actor_token is not supported",
      ],
    ])("refuses %s", async (_case, params, description) => {
      const { status, json } = await exchange({
        client_id: AGENT_ID,
        subject_token: "unused",
        ...params,
      });

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest(description),
      });
    });

    it("refuses a request without subject_token", async () => {
      const { status, json } = await exchange({ client_id: AGENT_ID });

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest("subject_token is required"),
      });
    });

    // R8: the app is the only target.
    it("refuses a request without a target", async () => {
      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: AGENT_ID,
        subject_token: "unused",
        subject_token_type: ACCESS_TOKEN_TYPE,
      });

      expect({ status, json }).toEqual({
        status: 400,
        json: invalidRequest("resource or audience is required"),
      });
    });

    it.each([
      ["UserInfo", { audience: `${authIssuer}/oauth2/userinfo` }],
      ["the MCP resource", { audience: MCP_AUDIENCE }],
      ["a relying party's client id", { audience: REMOTE_HOST_ID }],
      ["two targets", { resource: APP_AUDIENCE, audience: MCP_AUDIENCE }],
    ])("refuses %s as a target", async (_case, target) => {
      const { status, json } = await postTokenWithDpop({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: AGENT_ID,
        subject_token: "unused",
        subject_token_type: ACCESS_TOKEN_TYPE,
        ...target,
      });

      expect({ status, json }).toEqual({ status: 400, json: INVALID_TARGET });
    });

    it("refuses the wallet as a target", async () => {
      const { status, json } = await exchange({
        client_id: AGENT_ID,
        subject_token: "unused",
        audience: WALLET_AUDIENCE,
      });

      expect(status).toBe(400);
      expect(json.error).toBe("invalid_target");
    });

    // RFC 9449: every exchange is DPoP-bound.
    it("refuses a request without a DPoP proof", async () => {
      const response = await auth.handler(
        new Request(`${AUTH_URL}/oauth2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
            client_id: AGENT_ID,
            subject_token: "unused",
            subject_token_type: ACCESS_TOKEN_TYPE,
            audience: APP_AUDIENCE,
          }),
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_dpop_proof",
        error_description: "DPoP proof header is required",
      });
    });
  });
});
