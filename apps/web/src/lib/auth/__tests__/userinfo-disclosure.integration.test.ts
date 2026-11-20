import crypto from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { POST as createOAuthIdentityIntent } from "@/app/api/oauth2/identity/intent/route";
import { POST as stageOAuthIdentity } from "@/app/api/oauth2/identity/stage/route";
import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { PAIRWISE_PROOF_CONSENT_REFERENCE_PREFIX } from "@/lib/auth/oidc/disclosure/claims";
import { deleteExpiredPairwiseProofOnlyConsents } from "@/lib/auth/oidc/disclosure/consent-cleanup";
import {
  authorizationCodeGrantIdFor,
  stageFinalCibaDisclosure,
  stagePendingOauthDisclosure,
} from "@/lib/auth/oidc/disclosure/context";
import { createScopeHash } from "@/lib/auth/oidc/disclosure/delivery";
import {
  computeOAuthDisclosureRequestKey,
  computeOAuthRequestKey,
} from "@/lib/auth/oidc/oauth-request";
import { db } from "@/lib/db/connection";
import { sessions, verifications } from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
} from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestUser,
  hashCibaAuthReqId,
  resetDatabase,
  TEST_CIBA_CLIENT_SECRET,
  testCibaClientCredentials,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  type DpopKeyPair,
  postTokenWithDpop,
} from "@/test-utils/dpop-test-utils";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const REDIRECT_URI = "http://127.0.0.1/callback";
const TEST_CLIENT_ID = "userinfo-disclosure-client";
const TEST_AUTH_CODE_CLIENT_ID = "userinfo-disclosure-auth-code-client";
const SECOND_AUTH_CODE_CLIENT_ID = "userinfo-disclosure-second-client";
const TEST_AUTH_CODE_REFERENCE_ID = "userinfo-disclosure-auth-code-reference";
const TEST_SESSION_ID = "session-userinfo-disclosure";
const USERINFO_URL = "http://localhost:3000/api/auth/oauth2/userinfo";
const WHITESPACE_RE = /\s+/;

function clearIdentityPayloadStore(): void {
  const store = (
    globalThis as Record<symbol, Map<string, unknown> | undefined>
  )[Symbol.for("zentity.ephemeral-identity-claims")];
  store?.clear();
}

async function createTestClient(clientId = TEST_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "UserInfo Disclosure Test Client",
      redirectUris: JSON.stringify(["http://localhost/callback"]),
      grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
      ...testCibaClientCredentials,
    })
    .run();
}

async function createAuthCodeTestClient(clientId = TEST_AUTH_CODE_CLIENT_ID) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: "UserInfo Auth Code Disclosure Test Client",
      redirectUris: JSON.stringify([REDIRECT_URI]),
      grantTypes: JSON.stringify(["authorization_code"]),
      responseTypes: JSON.stringify(["code"]),
      tokenEndpointAuthMethod: "none",
      scopes: JSON.stringify(["openid", "identity.name"]),
      // These tests seed authorization-code rows directly; only the real
      // approval journey below exercises persisted consent enforcement.
      skipConsent: true,
      disabled: false,
      createdAt: new Date(),
    })
    .run();
}

async function insertApprovedCibaRequest(
  userId: string,
  authContextId: string,
  scope = "openid identity.name"
) {
  const authReqId = crypto.randomUUID();
  await db
    .insert(cibaRequests)
    .values({
      // Plugin stores the hash at rest; callers send the raw value.
      authReqId: hashCibaAuthReqId(authReqId),
      clientId: TEST_CLIENT_ID,
      userId,
      scope,
      status: "approved",
      // A Zentity approval makes the request reference its own hash.
      referenceId: hashCibaAuthReqId(authReqId),
      authContextId,
      expiresAt: new Date(Date.now() + 300_000),
    })
    .run();
  return authReqId;
}

async function createPkceChallenge(
  verifier: string
): Promise<{ challenge: string; verifier: string }> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  return {
    challenge: Buffer.from(digest).toString("base64url"),
    verifier,
  };
}

async function hashStoredAuthorizationCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code)
  );

  return Buffer.from(digest).toString("base64url");
}

async function parseHandlerJson(
  response: Response
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  const parsed = JSON.parse(text) as Record<string, unknown>;
  return parsed && typeof parsed === "object" && "response" in parsed
    ? (parsed.response as Record<string, unknown>)
    : parsed;
}

async function makeUserInfoRequest(
  accessToken: string,
  keyPair: DpopKeyPair
): Promise<Request> {
  // The access token is DPoP-bound, so userinfo requires the DPoP scheme plus a
  // fresh proof for this URL (HAIP requireDpop).
  const proof = await buildDpopProof(keyPair, "GET", USERINFO_URL, accessToken);
  return new Request(USERINFO_URL, {
    method: "GET",
    headers: {
      authorization: `DPoP ${accessToken}`,
      DPoP: proof,
    },
  });
}

async function insertSession(userId: string, authContextId: string) {
  const now = Date.now();
  await db
    .insert(sessions)
    .values({
      id: TEST_SESSION_ID,
      token: "session-token-userinfo-disclosure",
      userId,
      authContextId,
      createdAt: new Date(now - 60_000),
      updatedAt: new Date(now - 60_000),
      expiresAt: new Date(now + 60 * 60 * 1000),
    })
    .run();
  return `session-token-userinfo-disclosure.${await makeSignature(
    "session-token-userinfo-disclosure",
    env.BETTER_AUTH_SECRET
  )}`;
}

async function approveAuthorizationCode(input: {
  clientId: string;
  sessionToken: string;
  scope: string;
  userId: string;
  identity?: { family_name: string; given_name: string };
}): Promise<{
  authorizationCode: string;
  codeVerifier: string;
  disclosureRequestKey: string;
}> {
  const codeVerifier = `real-consent-verifier-${crypto.randomUUID()}`;
  const { challenge } = await createPkceChallenge(codeVerifier);
  const query = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: input.scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: crypto.randomUUID(),
  });
  const authorizeResponse = await auth.handler(
    new Request(
      `http://localhost:3000/api/auth/oauth2/authorize?${query.toString()}`,
      {
        headers: {
          cookie: `better-auth.session_token=${input.sessionToken}`,
        },
        redirect: "manual",
      }
    )
  );
  const consentPage = authorizeResponse.headers.get("location");
  if (authorizeResponse.status !== 302 || !consentPage) {
    throw new Error(
      `Authorize did not redirect to consent (${authorizeResponse.status})`
    );
  }
  const signedQuery = new URL(
    consentPage,
    "http://localhost:3000"
  ).search.slice(1);
  if (input.identity) {
    const identityScopes = input.scope
      .split(WHITESPACE_RE)
      .filter((scope) => scope.startsWith("identity."));
    const headers = {
      "content-type": "application/json",
      cookie: `better-auth.session_token=${input.sessionToken}`,
    };
    const intentResponse = await createOAuthIdentityIntent(
      new Request("http://localhost:3000/api/oauth2/identity/intent", {
        method: "POST",
        headers,
        body: JSON.stringify({
          oauth_query: signedQuery,
          scopes: identityScopes,
        }),
      })
    );
    const intentBody = (await intentResponse.json()) as {
      intent_token?: string;
    };
    if (!(intentResponse.ok && intentBody.intent_token)) {
      throw new Error(`Identity intent failed (${intentResponse.status})`);
    }
    const stageResponse = await stageOAuthIdentity(
      new Request("http://localhost:3000/api/oauth2/identity/stage", {
        method: "POST",
        headers,
        body: JSON.stringify({
          oauth_query: signedQuery,
          scopes: identityScopes,
          identity: input.identity,
          intent_token: intentBody.intent_token,
        }),
      })
    );
    if (!stageResponse.ok) {
      throw new Error(`Identity stage failed (${stageResponse.status})`);
    }
  }
  const consentResponse = await auth.handler(
    new Request("http://localhost:3000/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `better-auth.session_token=${input.sessionToken}`,
      },
      body: JSON.stringify({
        accept: true,
        scope: input.scope,
        oauth_query: signedQuery,
      }),
    })
  );
  const consentBody = await parseHandlerJson(consentResponse);
  let redirectURI: string | undefined;
  if (typeof consentBody.redirectURI === "string") {
    redirectURI = consentBody.redirectURI;
  } else if (typeof consentBody.url === "string") {
    redirectURI = consentBody.url;
  }
  if (!(consentResponse.ok && redirectURI)) {
    throw new Error(`Consent submit failed (${consentResponse.status})`);
  }
  const callback = new URL(redirectURI, "http://localhost:3000");
  const authorizationCode = callback.searchParams.get("code");
  if (!authorizationCode) {
    throw new Error("Consent response did not return an authorization code");
  }
  return {
    authorizationCode,
    codeVerifier,
    disclosureRequestKey: computeOAuthDisclosureRequestKey(
      new URLSearchParams(signedQuery)
    ),
  };
}

/**
 * Stages the identity (when given), stores an authorization code as the
 * provider would after consent, and redeems it at the token endpoint.
 */
async function redeemAuthorizationCode(input: {
  authContextId: string;
  clientId: string;
  identity?: { family_name: string; given_name: string };
  referenceId: string;
  userId: string;
}) {
  const identityScopes = ["identity.name"];
  const codeVerifier = `pkce-verifier-${input.clientId}`;
  const authorizationCode = `auth-code-${crypto.randomUUID()}`;
  const now = Date.now();
  const { challenge } = await createPkceChallenge(codeVerifier);
  const oauthQuery = {
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: `openid ${identityScopes.join(" ")}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };

  if (input.identity) {
    const staged = await stagePendingOauthDisclosure({
      userId: input.userId,
      clientId: input.clientId,
      claims: input.identity,
      scopes: identityScopes,
      scopeHash: createScopeHash(identityScopes),
      intentJti: crypto.randomUUID(),
      oauthRequestKey: computeOAuthRequestKey(oauthQuery),
    });
    if (!staged.ok) {
      throw new Error(`Identity staging failed: ${staged.reason}`);
    }
  }

  await db
    .insert(verifications)
    .values({
      id: crypto.randomUUID(),
      identifier: await hashStoredAuthorizationCode(authorizationCode),
      value: JSON.stringify({
        type: "authorization_code",
        referenceId: input.referenceId,
        query: oauthQuery,
        userId: input.userId,
        sessionId: TEST_SESSION_ID,
        authContextId: input.authContextId,
        authTime: now,
      }),
      createdAt: new Date(now),
      updatedAt: new Date(now),
      expiresAt: new Date(now + 5 * 60 * 1000),
    })
    .run();

  const tokenResponse = await postTokenWithDpop({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: REDIRECT_URI,
  });
  const accessToken = tokenResponse.json.access_token;
  if (tokenResponse.status !== 200 || typeof accessToken !== "string") {
    throw new Error(
      `Token request failed (${tokenResponse.status}): ${JSON.stringify(tokenResponse.json)}`
    );
  }
  return { accessToken, dpopKeyPair: tokenResponse.dpopKeyPair };
}

async function fetchUserInfo(token: {
  accessToken: string;
  dpopKeyPair: DpopKeyPair;
}) {
  const response = await auth.handler(
    await makeUserInfoRequest(token.accessToken, token.dpopKeyPair)
  );
  return { status: response.status, body: await parseHandlerJson(response) };
}

describe("userinfo disclosure binding", () => {
  let userId: string;
  let authContextId: string;

  beforeEach(async () => {
    await resetDatabase();
    clearIdentityPayloadStore();
    userId = await createTestUser();
    await createTestClient();
    authContextId = (
      await createAuthenticationContext({
        userId,
        loginMethod: "passkey",
        authenticatedAt: new Date(),
        sourceKind: "ciba_approval",
        referenceType: "ciba_request",
      })
    ).id;
  });

  it("completes approval, code exchange, and pairwise UserInfo while retaining fresh identity approval", async () => {
    const clientId = "userinfo-real-consent-pairwise-client";
    await db
      .insert(oauthClients)
      .values({
        clientId,
        name: "Real Consent Pairwise Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        scopes: JSON.stringify(["openid", "identity.name", "offline_access"]),
        skipConsent: false,
        subjectType: "pairwise",
        sectorIdentifier: `client/${clientId}`,
        disabled: false,
        createdAt: new Date(),
      })
      .run();

    const sessionToken = await insertSession(userId, authContextId);
    const scope = "openid identity.name offline_access";
    const { authorizationCode, codeVerifier, disclosureRequestKey } =
      await approveAuthorizationCode({
        clientId,
        sessionToken,
        scope,
        userId,
        identity: { given_name: "Ada", family_name: "Lovelace" },
      });
    const authorizationCodeId =
      await hashStoredAuthorizationCode(authorizationCode);
    const storedCode = await db
      .select({ value: verifications.value })
      .from(verifications)
      .where(eq(verifications.identifier, authorizationCodeId))
      .limit(1)
      .get();
    expect(JSON.parse(storedCode?.value ?? "{}")).toMatchObject({
      disclosureRequestKey,
      consentScopes: ["openid", "identity.name", "offline_access"],
    });
    const tokenResponse = await postTokenWithDpop({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });
    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.json.access_token).toBe("string");

    const userInfo = await fetchUserInfo({
      accessToken: tokenResponse.json.access_token as string,
      dpopKeyPair: tokenResponse.dpopKeyPair,
    });
    expect(userInfo.status).toBe(200);
    expect(userInfo.body.sub).toBeTruthy();
    expect(userInfo.body.sub).not.toBe(userId);
    expect(userInfo.body).toMatchObject({
      given_name: "Ada",
      family_name: "Lovelace",
    });

    const issuedToken = await db
      .select({ grantId: oauthAccessTokens.grantId })
      .from(oauthAccessTokens)
      .where(
        and(
          eq(oauthAccessTokens.clientId, clientId),
          eq(oauthAccessTokens.userId, userId),
          eq(oauthAccessTokens.authorizationCodeId, authorizationCodeId)
        )
      )
      .limit(1)
      .get();
    expect(issuedToken?.grantId).toBe(
      authorizationCodeGrantIdFor(authorizationCodeId)
    );

    const storedConsent = await db
      .select({
        referenceId: oauthConsents.referenceId,
        scopes: oauthConsents.scopes,
      })
      .from(oauthConsents)
      .where(
        and(
          eq(oauthConsents.clientId, clientId),
          eq(oauthConsents.userId, userId)
        )
      )
      .limit(1)
      .get();
    expect(storedConsent?.referenceId).toBeTruthy();
    expect(JSON.parse(storedConsent?.scopes ?? "[]")).not.toContain(
      "identity.name"
    );

    const repeatChallenge = await createPkceChallenge(
      `repeat-${crypto.randomUUID()}`
    );
    const repeatQuery = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope,
      code_challenge: repeatChallenge.challenge,
      code_challenge_method: "S256",
      state: crypto.randomUUID(),
    });
    const repeatAuthorize = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/oauth2/authorize?${repeatQuery}`,
        {
          headers: {
            cookie: `better-auth.session_token=${sessionToken}`,
          },
          redirect: "manual",
        }
      )
    );
    const repeatLocation = repeatAuthorize.headers.get("location");
    expect(repeatLocation).toContain("/oauth/consent");
  });

  it("keeps pairwise consent available through redemption, then removes it after a non-identity grant", async () => {
    const clientId = "userinfo-real-consent-cleanup-client";
    await db
      .insert(oauthClients)
      .values({
        clientId,
        name: "Real Consent Cleanup Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        scopes: JSON.stringify(["openid", "offline_access"]),
        skipConsent: false,
        subjectType: "pairwise",
        sectorIdentifier: `client/${clientId}`,
        disabled: false,
        createdAt: new Date(),
      })
      .run();

    const sessionToken = await insertSession(userId, authContextId);
    const { authorizationCode, codeVerifier } = await approveAuthorizationCode({
      clientId,
      sessionToken,
      scope: "openid offline_access",
      userId,
    });
    expect(
      await db
        .select({ id: oauthConsents.id })
        .from(oauthConsents)
        .where(
          and(
            eq(oauthConsents.clientId, clientId),
            eq(oauthConsents.userId, userId)
          )
        )
        .all()
    ).toHaveLength(1);

    const tokenResponse = await postTokenWithDpop({
      grant_type: "authorization_code",
      client_id: clientId,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });
    expect(tokenResponse.status).toBe(200);
    expect(
      await db
        .select({ id: oauthConsents.id })
        .from(oauthConsents)
        .where(
          and(
            eq(oauthConsents.clientId, clientId),
            eq(oauthConsents.userId, userId)
          )
        )
        .all()
    ).toHaveLength(0);
  });

  it("redeems concurrent pairwise proof-only codes independently", async () => {
    const clientId = "userinfo-concurrent-consent-client";
    await db
      .insert(oauthClients)
      .values({
        clientId,
        name: "Concurrent Consent Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify(["authorization_code"]),
        responseTypes: JSON.stringify(["code"]),
        tokenEndpointAuthMethod: "none",
        scopes: JSON.stringify(["openid", "offline_access"]),
        skipConsent: false,
        subjectType: "pairwise",
        sectorIdentifier: `client/${clientId}`,
        disabled: false,
        createdAt: new Date(),
      })
      .run();

    const sessionToken = await insertSession(userId, authContextId);
    const firstCode = await approveAuthorizationCode({
      clientId,
      sessionToken,
      scope: "openid offline_access",
      userId,
    });
    const secondCode = await approveAuthorizationCode({
      clientId,
      sessionToken,
      scope: "openid offline_access",
      userId,
    });
    const consents = await db
      .select({ referenceId: oauthConsents.referenceId })
      .from(oauthConsents)
      .where(
        and(
          eq(oauthConsents.clientId, clientId),
          eq(oauthConsents.userId, userId)
        )
      )
      .all();
    expect(consents).toHaveLength(2);
    expect(consents[0]?.referenceId).not.toBe(consents[1]?.referenceId);

    for (const code of [firstCode, secondCode]) {
      const response = await postTokenWithDpop({
        grant_type: "authorization_code",
        client_id: clientId,
        code: code.authorizationCode,
        code_verifier: code.codeVerifier,
        redirect_uri: REDIRECT_URI,
      });
      expect(response.status).toBe(200);
      const remaining = await db
        .select({ id: oauthConsents.id })
        .from(oauthConsents)
        .where(
          and(
            eq(oauthConsents.clientId, clientId),
            eq(oauthConsents.userId, userId)
          )
        )
        .all();
      expect(remaining).toHaveLength(code === firstCode ? 1 : 0);
    }
  });

  it("cleans expired proof-only pairwise consents and preserves identity consents", async () => {
    const proofClientId = "userinfo-expired-proof-consent-client";
    const identityClientId = "userinfo-expired-identity-consent-client";
    for (const [clientId, scopes] of [
      [proofClientId, ["openid", "proof:age"]],
      [identityClientId, ["openid", "identity.name"]],
    ] as const) {
      await db
        .insert(oauthClients)
        .values({
          clientId,
          name: clientId,
          redirectUris: JSON.stringify([REDIRECT_URI]),
          grantTypes: JSON.stringify(["authorization_code"]),
          responseTypes: JSON.stringify(["code"]),
          tokenEndpointAuthMethod: "none",
          scopes: JSON.stringify(scopes),
          skipConsent: false,
          subjectType: "pairwise",
          sectorIdentifier: `client/${clientId}`,
          disabled: false,
          createdAt: new Date(),
        })
        .run();
      await db
        .insert(oauthConsents)
        .values({
          id: `expired-${clientId}`,
          clientId,
          userId,
          referenceId:
            clientId === proofClientId
              ? `${PAIRWISE_PROOF_CONSENT_REFERENCE_PREFIX}old-code`
              : `identity-approved-${clientId}`,
          // Identity scopes are deliberately stripped from persisted consent.
          scopes: JSON.stringify(["openid"]),
          createdAt: new Date(Date.now() - 11 * 60 * 1000),
        })
        .run();
    }

    expect(await deleteExpiredPairwiseProofOnlyConsents()).toBe(1);
    const remaining = await db
      .select({ clientId: oauthConsents.clientId })
      .from(oauthConsents)
      .where(eq(oauthConsents.userId, userId))
      .all();
    expect(remaining.map((row) => row.clientId)).toEqual([identityClientId]);
  });

  it("delivers an exact bound identity payload once for opaque CIBA access tokens", async () => {
    const authReqId = await insertApprovedCibaRequest(userId, authContextId);
    const identityScopes = ["identity.name"];

    expect(
      await stageFinalCibaDisclosure({
        userId,
        clientId: TEST_CLIENT_ID,
        claims: {
          given_name: "Ada",
          family_name: "Lovelace",
        },
        authReqId: hashCibaAuthReqId(authReqId),
        scopes: identityScopes,
        scopeHash: createScopeHash(identityScopes),
        intentJti: crypto.randomUUID(),
      })
    ).toEqual({ ok: true });

    const tokenResponse = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      client_secret: TEST_CIBA_CLIENT_SECRET,
      auth_req_id: authReqId,
      client_id: TEST_CLIENT_ID,
    });

    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.json.access_token).toBe("string");

    const accessToken = tokenResponse.json.access_token as string;
    expect(accessToken.split(".").length).not.toBe(3);

    const firstUserInfo = await auth.handler(
      await makeUserInfoRequest(accessToken, tokenResponse.dpopKeyPair)
    );
    expect(firstUserInfo.status).toBe(200);
    await expect(parseHandlerJson(firstUserInfo)).resolves.toMatchObject({
      sub: userId,
      given_name: "Ada",
      family_name: "Lovelace",
    });

    const secondUserInfo = await auth.handler(
      await makeUserInfoRequest(accessToken, tokenResponse.dpopKeyPair)
    );
    const secondBody = await parseHandlerJson(secondUserInfo);
    expect(secondUserInfo.status).toBe(401);
    expect(secondBody.error).toBe("invalid_token");
    expect(secondUserInfo.headers.get("WWW-Authenticate")).toBe(
      'DPoP error="invalid_token", error_description="identity_payload_missing", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource", algs="ES256"'
    );
  });

  it("delivers OAuth authorization-code identity payloads without public release claims", async () => {
    await createAuthCodeTestClient();
    await insertSession(userId, authContextId);

    const token = await redeemAuthorizationCode({
      authContextId,
      clientId: TEST_AUTH_CODE_CLIENT_ID,
      identity: { given_name: "Grace", family_name: "Hopper" },
      referenceId: TEST_AUTH_CODE_REFERENCE_ID,
      userId,
    });

    if (token.accessToken.split(".").length === 3) {
      const payload = decodeJwt(token.accessToken);
      expect(payload).not.toHaveProperty("zentity_release_id");
      expect(payload).not.toHaveProperty("zentity_context_id");
    }

    const userInfo = await fetchUserInfo(token);
    expect(userInfo.status).toBe(200);
    expect(userInfo.body).toMatchObject({
      sub: userId,
      given_name: "Grace",
      family_name: "Hopper",
    });
  });

  it("binds a later sign-in without a new step-up to no identity release, and releases a new step-up again", async () => {
    await createAuthCodeTestClient();
    await insertSession(userId, authContextId);

    const stepUpToken = await redeemAuthorizationCode({
      authContextId,
      clientId: TEST_AUTH_CODE_CLIENT_ID,
      identity: { given_name: "Grace", family_name: "Hopper" },
      referenceId: TEST_AUTH_CODE_REFERENCE_ID,
      userId,
    });
    const stepUpUserInfo = await fetchUserInfo(stepUpToken);
    expect(stepUpUserInfo.status).toBe(200);
    expect(stepUpUserInfo.body).toMatchObject({
      given_name: "Grace",
      family_name: "Hopper",
    });

    const signInToken = await redeemAuthorizationCode({
      authContextId,
      clientId: TEST_AUTH_CODE_CLIENT_ID,
      referenceId: TEST_AUTH_CODE_REFERENCE_ID,
      userId,
    });
    const signInUserInfo = await fetchUserInfo(signInToken);
    expect(signInUserInfo.status).toBe(200);
    expect(signInUserInfo.body.sub).toBe(userId);
    expect(signInUserInfo.body).not.toHaveProperty("given_name");
    expect(signInUserInfo.body).not.toHaveProperty("family_name");

    const secondStepUpToken = await redeemAuthorizationCode({
      authContextId,
      clientId: TEST_AUTH_CODE_CLIENT_ID,
      identity: { given_name: "Ada", family_name: "Lovelace" },
      referenceId: TEST_AUTH_CODE_REFERENCE_ID,
      userId,
    });
    const secondStepUpUserInfo = await fetchUserInfo(secondStepUpToken);
    expect(secondStepUpUserInfo.status).toBe(200);
    expect(secondStepUpUserInfo.body).toMatchObject({
      given_name: "Ada",
      family_name: "Lovelace",
    });
  });

  // The provider derives one consent reference per user, session, and
  // non-identity scope set, so every relying party a user signs in to during
  // one session receives the same referenceId.
  describe("two clients sharing a consent reference", () => {
    beforeEach(async () => {
      await createAuthCodeTestClient(TEST_AUTH_CODE_CLIENT_ID);
      await createAuthCodeTestClient(SECOND_AUTH_CODE_CLIENT_ID);
      await insertSession(userId, authContextId);
    });

    it("releases the staged identity only to the client that staged it", async () => {
      const stagingClientToken = await redeemAuthorizationCode({
        authContextId,
        clientId: TEST_AUTH_CODE_CLIENT_ID,
        identity: { given_name: "Grace", family_name: "Hopper" },
        referenceId: TEST_AUTH_CODE_REFERENCE_ID,
        userId,
      });
      const otherClientToken = await redeemAuthorizationCode({
        authContextId,
        clientId: SECOND_AUTH_CODE_CLIENT_ID,
        referenceId: TEST_AUTH_CODE_REFERENCE_ID,
        userId,
      });

      const otherUserInfo = await fetchUserInfo(otherClientToken);
      expect(otherUserInfo.status).toBe(200);
      expect(otherUserInfo.body.sub).toBe(userId);
      expect(otherUserInfo.body).not.toHaveProperty("given_name");
      expect(otherUserInfo.body).not.toHaveProperty("family_name");

      const stagingUserInfo = await fetchUserInfo(stagingClientToken);
      expect(stagingUserInfo.status).toBe(200);
      expect(stagingUserInfo.body).toMatchObject({
        sub: userId,
        given_name: "Grace",
        family_name: "Hopper",
      });
    });

    it("keeps each client's pending identity release separate", async () => {
      const firstToken = await redeemAuthorizationCode({
        authContextId,
        clientId: TEST_AUTH_CODE_CLIENT_ID,
        identity: { given_name: "Grace", family_name: "Hopper" },
        referenceId: TEST_AUTH_CODE_REFERENCE_ID,
        userId,
      });
      const secondToken = await redeemAuthorizationCode({
        authContextId,
        clientId: SECOND_AUTH_CODE_CLIENT_ID,
        identity: { given_name: "Ada", family_name: "Lovelace" },
        referenceId: TEST_AUTH_CODE_REFERENCE_ID,
        userId,
      });

      const secondUserInfo = await fetchUserInfo(secondToken);
      expect(secondUserInfo.status).toBe(200);
      expect(secondUserInfo.body).toMatchObject({
        given_name: "Ada",
        family_name: "Lovelace",
      });

      const firstUserInfo = await fetchUserInfo(firstToken);
      expect(firstUserInfo.status).toBe(200);
      expect(firstUserInfo.body).toMatchObject({
        given_name: "Grace",
        family_name: "Hopper",
      });
    });
  });

  it("reads UserInfo with a pairwise client's JWT access token", async () => {
    const clientId = "userinfo-pairwise-jwt-client";
    await db
      .insert(oauthClients)
      .values({
        clientId,
        name: "Pairwise JWT Client",
        redirectUris: JSON.stringify([REDIRECT_URI]),
        grantTypes: JSON.stringify([CIBA_GRANT_TYPE]),
        ...testCibaClientCredentials,
        subjectType: "pairwise",
        sectorIdentifier: `client/${clientId}`,
        metadata: JSON.stringify({ backchannel_token_delivery_mode: "poll" }),
      })
      .run();
    const { authReqId } = await createTestCibaRequest({
      clientId,
      userId,
      status: "approved",
      resources: JSON.stringify([env.MCP_PUBLIC_URL]),
    });

    const tokenResponse = await postTokenWithDpop({
      grant_type: CIBA_GRANT_TYPE,
      client_secret: TEST_CIBA_CLIENT_SECRET,
      auth_req_id: authReqId,
      client_id: clientId,
    });
    expect(tokenResponse.status).toBe(200);
    const accessToken = tokenResponse.json.access_token as string;
    const idTokenSub = decodeJwt(tokenResponse.json.id_token as string).sub;
    const claims = decodeJwt(accessToken);
    expect(idTokenSub).not.toBe(userId);
    // The JWT names the user for its audience, UserInfo for the client.
    expect(claims.sub).not.toBe(idTokenSub);
    expect(claims.ba_sub).toEqual(expect.any(String));

    const userInfo = await fetchUserInfo({
      accessToken,
      dpopKeyPair: tokenResponse.dpopKeyPair,
    });
    expect(userInfo).toEqual({
      status: 200,
      body: expect.objectContaining({ sub: idTokenSub }),
    });
  });
});
