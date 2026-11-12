import crypto from "node:crypto";

import { DPOP_NONCE_HEADER } from "@better-auth/core/oauth2";
import { client, ready, server } from "@serenity-kit/opaque";
import { encodeEd25519DidKeyFromJwk } from "@zentity/sdk/protocol";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { GET as authRouteGet } from "@/app/api/auth/[...all]/route";
import { POST as registerHost } from "@/app/api/auth/agent/host/register/route";
import { POST as proofOfHuman } from "@/app/api/auth/oauth2/proof-of-human/route";
import { GET as getValidity } from "@/app/api/auth/oauth2/validity/route";
import { GET as trpcGet } from "@/app/api/trpc/[trpc]/route";
import { env } from "@/env";
import {
  AGENT_BOOTSTRAP_TOKEN_USE,
  AGENT_HOST_REGISTER_SCOPE,
} from "@/lib/agents/session";
import { auth } from "@/lib/auth/auth-config";
import { fpaLimiter } from "@/lib/auth/oidc/authorize-challenge";
import { mintOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";
import { db } from "@/lib/db/connection";
import { accounts, verifications } from "@/lib/db/schema/auth";
import { humanityCredentials } from "@/lib/db/schema/identity";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  createTestCibaRequest,
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import {
  buildDpopProof,
  createTestDpopKeyPair,
  type DpopKeyPair,
  hasStatus,
  readAcceptedDpopNonce,
  readDpopNonceChallenge,
  runDpopNonceRoundTrip,
} from "@/test-utils/dpop-test-utils";

const APP_URL = "http://localhost:3000";
const AUTH_URL = `${APP_URL}/api/auth`;
const TOKEN_URL = `${AUTH_URL}/oauth2/token`;
const USERINFO_URL = `${AUTH_URL}/oauth2/userinfo`;
const CHALLENGE_URL = `${AUTH_URL}/oauth2/authorize-challenge`;
const HOST_REGISTER_URL = `${AUTH_URL}/agent/host/register`;
const POH_URL = `${AUTH_URL}/oauth2/proof-of-human`;
const VALIDITY_URL = `${AUTH_URL}/oauth2/validity`;
const TRPC_URL = `${APP_URL}/api/trpc/assurance.profile`;
const CREDENTIAL_URL = `${AUTH_URL}/oidc4vci/credential`;

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";
const CODE_CLIENT_ID = "nonce-code-client";
const CIBA_CLIENT_ID = "nonce-ciba-client";
const EXCHANGE_CLIENT_ID = "nonce-exchange-client";
const FPA_CLIENT_ID = "nonce-fpa-client";
const WALLET_CLIENT_ID = "nonce-wallet-client";
const PRE_AUTHORIZED_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code";
const CREDENTIAL_CONFIGURATION_ID = "identity_verification";
const REDIRECT_URI = "http://127.0.0.1/callback";
const TEST_EMAIL = "nonce@example.com";
const TEST_PASSWORD = "correct-horse-battery-staple";
// RFC 7636 example: code_verifier → code_challenge (S256)
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const HOST_DID = encodeEd25519DidKeyFromJwk({
  crv: "Ed25519",
  kty: "OKP",
  x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
});

type NonceSender = (nonce: string | null) => Promise<Response>;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

async function insertClient(
  clientId: string,
  grantTypes: string[],
  overrides: Partial<typeof oauthClients.$inferInsert> = {}
) {
  await db
    .insert(oauthClients)
    .values({
      clientId,
      name: clientId,
      grantTypes: JSON.stringify(grantTypes),
      redirectUris: JSON.stringify([REDIRECT_URI]),
      responseTypes: JSON.stringify(["code"]),
      scopes: JSON.stringify(["openid", "offline_access", "poh"]),
      tokenEndpointAuthMethod: "none",
      ...overrides,
    })
    .run();
}

async function registerOpaquePassword(userId: string) {
  await ready;
  const { registrationRequest, clientRegistrationState } =
    client.startRegistration({ password: TEST_PASSWORD });
  const { registrationResponse } = server.createRegistrationResponse({
    serverSetup: env.OPAQUE_SERVER_SETUP,
    userIdentifier: userId,
    registrationRequest,
  });
  const { registrationRecord } = client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password: TEST_PASSWORD,
  });
  await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "opaque",
      userId,
      registrationRecord,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}

/** A token request whose proof carries the nonce the sender is given. */
function tokenSender(
  keyPair: DpopKeyPair,
  body: Record<string, string>
): NonceSender {
  return async (nonce) =>
    auth.handler(
      new Request(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: await buildDpopProof(keyPair, "POST", TOKEN_URL, undefined, {
            nonce,
          }),
        },
        body: new URLSearchParams(body),
      })
    );
}

/** A request to a protected resource with a DPoP-bound access token. */
function resourceSender(
  keyPair: DpopKeyPair,
  accessToken: string,
  input: {
    body?: Record<string, unknown>;
    handler: (request: Request) => Promise<Response>;
    method: "GET" | "POST";
    url: string;
  }
): NonceSender {
  return async (nonce) =>
    input.handler(
      new Request(input.url, {
        method: input.method,
        headers: {
          Authorization: `DPoP ${accessToken}`,
          DPoP: await buildDpopProof(
            keyPair,
            input.method,
            input.url,
            accessToken,
            { nonce }
          ),
          ...(input.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      })
    );
}

function challengeSender(
  keyPair: DpopKeyPair,
  body: Record<string, unknown>
): NonceSender {
  return async (nonce) =>
    auth.handler(
      new Request(CHALLENGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          DPoP: await buildDpopProof(
            keyPair,
            "POST",
            CHALLENGE_URL,
            undefined,
            {
              nonce,
            }
          ),
        },
        body: JSON.stringify(body),
      })
    );
}

/** Accepts the FPA `insufficient_authorization` answer with `status`. */
function isInsufficientAuthorization(
  status: number
): (response: Response) => Promise<boolean> {
  return async (response) =>
    response.status === status &&
    ((await response.json()) as { error?: unknown }).error ===
      "insufficient_authorization";
}

describe("server-provided DPoP nonces", () => {
  let userId: string;
  let sessionId: string;
  let sessionToken: string;
  let authContextId: string;

  beforeEach(async () => {
    await resetDatabase();
    fpaLimiter.reset();
    userId = await createTestUser({ email: TEST_EMAIL });
    ({
      sessionId,
      token: sessionToken,
      authContextId,
    } = await createTestSession(userId));
    await insertClient(CODE_CLIENT_ID, ["authorization_code", "refresh_token"]);
    await insertClient(CIBA_CLIENT_ID, [CIBA_GRANT_TYPE]);
    await insertClient(
      EXCHANGE_CLIENT_ID,
      ["authorization_code", TOKEN_EXCHANGE_GRANT_TYPE],
      { subjectType: "pairwise" }
    );
    await insertClient(FPA_CLIENT_ID, ["authorization_code", CIBA_GRANT_TYPE], {
      firstParty: true,
    });
    await insertClient(WALLET_CLIENT_ID, [PRE_AUTHORIZED_GRANT_TYPE], {
      skipConsent: true,
    });
  });

  /** Stores an authorization code as the authorize endpoint would. */
  async function insertAuthorizationCode(
    overrides: { referenceId?: string } = {}
  ): Promise<string> {
    const code = crypto.randomUUID();
    const now = Date.now();
    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        identifier: sha256(code),
        value: JSON.stringify({
          type: "authorization_code",
          ...overrides,
          query: {
            client_id: CODE_CLIENT_ID,
            response_type: "code",
            redirect_uri: REDIRECT_URI,
            scope: "openid offline_access",
            code_challenge: CODE_CHALLENGE,
            code_challenge_method: "S256",
            resource: APP_URL,
          },
          userId,
          sessionId,
          authContextId,
        }),
        createdAt: new Date(now),
        updatedAt: new Date(now),
        expiresAt: new Date(now + 5 * 60 * 1000),
      })
      .run();
    return code;
  }

  function authorizationCodeBody(code: string): Record<string, string> {
    return {
      grant_type: "authorization_code",
      client_id: CODE_CLIENT_ID,
      code,
      code_verifier: CODE_VERIFIER,
      redirect_uri: REDIRECT_URI,
      resource: APP_URL,
    };
  }

  async function mintDpopBoundToken(
    keyPair: DpopKeyPair,
    input: {
      clientId?: string;
      exchangeClaims?: Record<string, unknown>;
      scopes: string[];
    }
  ): Promise<string> {
    return mintOpaqueAccessToken({
      act: { sub: input.clientId ?? CODE_CLIENT_ID },
      authContextId,
      clientId: input.clientId ?? CODE_CLIENT_ID,
      dpopJkt: await calculateJwkThumbprint(keyPair.jwk),
      exchangeClaims: input.exchangeClaims ?? {},
      expiresAt: new Date(Date.now() + 3_600_000),
      referenceId: crypto.randomUUID(),
      scopes: input.scopes,
      sessionId,
      userId,
    });
  }

  describe("token endpoint", () => {
    it("asks for a nonce before redeeming an authorization code", async () => {
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: hasStatus(200),
        prepare: async () =>
          tokenSender(
            keyPair,
            authorizationCodeBody(await insertAuthorizationCode())
          ),
      });
    });

    it("asks for the nonce before Zentity's token hooks stage the grant", async () => {
      const keyPair = await createTestDpopKeyPair();
      const code = await insertAuthorizationCode({
        referenceId: "consent-reference",
      });
      const storedReference = async () => {
        const row = await db
          .select({ value: verifications.value })
          .from(verifications)
          .where(eq(verifications.identifier, sha256(code)))
          .get();
        return (JSON.parse(row?.value ?? "{}") as { referenceId?: string })
          .referenceId;
      };

      const send = tokenSender(keyPair, authorizationCodeBody(code));
      const nonce = await readDpopNonceChallenge(
        await send(null),
        "authorization_server"
      );

      // The hook that rebinds the code to its own reference has not run.
      expect(await storedReference()).toBe("consent-reference");
      expect((await send(nonce)).status).toBe(200);
    });

    it("asks for a nonce on a refresh token grant", async () => {
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: hasStatus(200),
        prepare: async () => {
          const issued = await tokenSender(
            keyPair,
            authorizationCodeBody(await insertAuthorizationCode())
          )(await currentNonceFromServer(keyPair));
          await readAcceptedDpopNonce(issued, hasStatus(200));
          const { refresh_token } = (await issued.json()) as {
            refresh_token: string;
          };
          return tokenSender(keyPair, {
            grant_type: "refresh_token",
            client_id: CODE_CLIENT_ID,
            refresh_token,
            resource: APP_URL,
          });
        },
      });
    });

    it("asks for a nonce on a CIBA poll", async () => {
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: hasStatus(200),
        prepare: async () => {
          const { authReqId } = await createTestCibaRequest({
            clientId: CIBA_CLIENT_ID,
            userId,
            status: "approved",
          });
          return tokenSender(keyPair, {
            grant_type: CIBA_GRANT_TYPE,
            auth_req_id: authReqId,
            client_id: CIBA_CLIENT_ID,
          });
        },
      });
    });

    it("asks for a nonce on a token exchange", async () => {
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: hasStatus(200),
        prepare: async () => {
          const subjectToken = await mintDpopBoundToken(keyPair, {
            clientId: EXCHANGE_CLIENT_ID,
            scopes: ["openid"],
          });
          return tokenSender(keyPair, {
            grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
            client_id: EXCHANGE_CLIENT_ID,
            subject_token: subjectToken,
            subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
            audience: APP_URL,
            scope: AGENT_HOST_REGISTER_SCOPE,
          });
        },
      });
    });

    it("asks for a nonce before the CIBA step-up check binds an auth_session", async () => {
      await registerOpaquePassword(userId);
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: isInsufficientAuthorization(403),
        prepare: async () => {
          const { authReqId } = await createTestCibaRequest({
            clientId: FPA_CLIENT_ID,
            userId,
            status: "approved",
            acrValues: "urn:zentity:assurance:tier-3",
          });
          return tokenSender(keyPair, {
            grant_type: CIBA_GRANT_TYPE,
            auth_req_id: authReqId,
            client_id: FPA_CLIENT_ID,
          });
        },
      });
    });

    it("hands the step-up client the nonce for its re-authentication", async () => {
      await registerOpaquePassword(userId);
      const keyPair = await createTestDpopKeyPair();
      const { authReqId } = await createTestCibaRequest({
        clientId: FPA_CLIENT_ID,
        userId,
        status: "approved",
        acrValues: "urn:zentity:assurance:tier-3",
      });
      const stepUp = await tokenSender(keyPair, {
        grant_type: CIBA_GRANT_TYPE,
        auth_req_id: authReqId,
        client_id: FPA_CLIENT_ID,
      })(await currentNonceFromServer(keyPair));
      const stepUpNonce = await readAcceptedDpopNonce(
        stepUp,
        isInsufficientAuthorization(403)
      );
      const { auth_session } = (await stepUp.json()) as {
        auth_session: string;
      };

      const reentry = await challengeSender(keyPair, { auth_session })(
        stepUpNonce
      );
      expect(await isInsufficientAuthorization(401)(reentry)).toBe(true);
    });
  });

  it("asks for a nonce at UserInfo", async () => {
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await mintDpopBoundToken(keyPair, {
      scopes: ["openid"],
    });
    await runDpopNonceRoundTrip({
      kind: "resource_server",
      accepts: hasStatus(200),
      prepare: async () =>
        resourceSender(keyPair, accessToken, {
          handler: authRouteGet,
          method: "GET",
          url: USERINFO_URL,
        }),
    });
  });

  it("asks for a nonce on tRPC calls made with an access token", async () => {
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await mintDpopBoundToken(keyPair, {
      scopes: ["openid"],
    });
    await runDpopNonceRoundTrip({
      kind: "resource_server",
      accepts: hasStatus(200),
      prepare: async () =>
        resourceSender(keyPair, accessToken, {
          handler: trpcGet,
          method: "GET",
          url: TRPC_URL,
        }),
    });
  });

  it("asks for a nonce at agent host registration", async () => {
    const keyPair = await createTestDpopKeyPair();
    const bootstrapToken = await mintDpopBoundToken(keyPair, {
      exchangeClaims: { zentity_token_use: AGENT_BOOTSTRAP_TOKEN_USE },
      scopes: [AGENT_HOST_REGISTER_SCOPE],
    });
    await runDpopNonceRoundTrip({
      kind: "resource_server",
      // The first registration creates the host; later ones update it.
      accepts: hasStatus(200, 201),
      prepare: async () =>
        resourceSender(keyPair, bootstrapToken, {
          body: { did: HOST_DID, name: "Nonce Host" },
          handler: registerHost,
          method: "POST",
          url: HOST_REGISTER_URL,
        }),
    });
  });

  it("asks for a nonce at the Proof-of-Human endpoint", async () => {
    await db
      .insert(humanityCredentials)
      .values({
        id: crypto.randomUUID(),
        userId,
        provider: "world_id_orb",
        providerSubjectKind: "nullifier",
        providerSubjectHash: sha256(userId),
      })
      .run();
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await mintDpopBoundToken(keyPair, {
      scopes: ["openid", "poh"],
    });
    await runDpopNonceRoundTrip({
      kind: "resource_server",
      accepts: hasStatus(200),
      prepare: async () =>
        resourceSender(keyPair, accessToken, {
          handler: proofOfHuman,
          method: "POST",
          url: POH_URL,
        }),
    });
  });

  it("asks for a nonce at the validity endpoint", async () => {
    const keyPair = await createTestDpopKeyPair();
    const accessToken = await mintDpopBoundToken(keyPair, {
      scopes: ["openid", "poh"],
    });
    await runDpopNonceRoundTrip({
      kind: "resource_server",
      accepts: hasStatus(200),
      prepare: async () =>
        resourceSender(keyPair, accessToken, {
          handler: getValidity,
          method: "GET",
          url: VALIDITY_URL,
        }),
    });
  });

  describe("authorization challenge endpoint", () => {
    const initialRequest = {
      client_id: FPA_CLIENT_ID,
      response_type: "code",
      scope: "openid",
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
      identifier: TEST_EMAIL,
    };

    beforeEach(async () => {
      await registerOpaquePassword(userId);
    });

    it("asks for a nonce before it binds an auth_session", async () => {
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: isInsufficientAuthorization(401),
        prepare: async () => challengeSender(keyPair, initialRequest),
      });
    });

    it("carries one nonce across every round and into the token endpoint", async () => {
      const keyPair = await createTestDpopKeyPair();
      const round1 = await challengeSender(
        keyPair,
        initialRequest
      )(await currentNonceFromServer(keyPair));
      const round1Nonce = await readAcceptedDpopNonce(
        round1,
        isInsufficientAuthorization(401)
      );
      const { auth_session } = (await round1.json()) as {
        auth_session: string;
      };

      const { clientLoginState, startLoginRequest } = client.startLogin({
        password: TEST_PASSWORD,
      });
      const round2 = await challengeSender(keyPair, {
        auth_session,
        opaque_login_request: startLoginRequest,
      })(round1Nonce);
      const round2Nonce = await readAcceptedDpopNonce(round2, hasStatus(200));
      const { opaque_login_response } = (await round2.json()) as {
        opaque_login_response: string;
      };

      const login = client.finishLogin({
        clientLoginState,
        loginResponse: opaque_login_response,
        password: TEST_PASSWORD,
      });
      const round3 = await challengeSender(keyPair, {
        auth_session,
        opaque_finish_request: login?.finishLoginRequest,
      })(round2Nonce);
      const round3Nonce = await readAcceptedDpopNonce(round3, hasStatus(200));
      const { authorization_code } = (await round3.json()) as {
        authorization_code: string;
      };

      // The token endpoint shares the origin's nonce, so the first try works.
      const token = await tokenSender(keyPair, {
        grant_type: "authorization_code",
        client_id: FPA_CLIENT_ID,
        code: authorization_code,
        code_verifier: CODE_VERIFIER,
      })(round3Nonce);
      expect(token.status).toBe(200);
    });

    it("leaves requests without a DPoP proof alone", async () => {
      const response = await auth.handler(
        new Request(CHALLENGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(initialRequest),
        })
      );
      expect(response.headers.get(DPOP_NONCE_HEADER)).toBeNull();
      expect(await isInsufficientAuthorization(401)(response)).toBe(true);
    });
  });

  describe("OpenID4VCI", () => {
    /** A credential offer's pre-authorized code, as the user's wallet gets it. */
    async function createPreAuthorizedCode(): Promise<string> {
      const signature = await makeSignature(
        sessionToken,
        env.BETTER_AUTH_SECRET
      );
      const response = await auth.handler(
        new Request(`${AUTH_URL}/oidc4vci/credential-offer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `better-auth.session_token=${sessionToken}.${signature}`,
            Origin: APP_URL,
          },
          body: JSON.stringify({
            client_id: WALLET_CLIENT_ID,
            credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
          }),
        })
      );
      const body = (await response.json()) as {
        credential_offer?: {
          grants?: Record<string, { "pre-authorized_code"?: string }>;
        };
      };
      const code =
        body.credential_offer?.grants?.[PRE_AUTHORIZED_GRANT_TYPE]?.[
          "pre-authorized_code"
        ];
      if (!code) {
        throw new Error(`credential offer failed: ${JSON.stringify(body)}`);
      }
      return code;
    }

    function preAuthorizedTokenBody(code: string): Record<string, string> {
      return {
        grant_type: PRE_AUTHORIZED_GRANT_TYPE,
        "pre-authorized_code": code,
        client_id: WALLET_CLIENT_ID,
      };
    }

    /** A `jwt` proof of possession bound to a fresh `c_nonce`. */
    async function credentialRequestBody(): Promise<Record<string, unknown>> {
      const nonceResponse = await auth.handler(
        new Request(`${AUTH_URL}/oidc4vci/nonce`, { method: "POST" })
      );
      const { c_nonce } = (await nonceResponse.json()) as { c_nonce: string };
      const holder = await generateKeyPair("EdDSA");
      const proofJwt = await new SignJWT({ nonce: c_nonce })
        .setProtectedHeader({
          alg: "EdDSA",
          jwk: await exportJWK(holder.publicKey),
          typ: "openid4vci-proof+jwt",
        })
        .setIssuedAt()
        .setAudience(AUTH_URL)
        .sign(holder.privateKey);
      return {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proofs: { jwt: [proofJwt] },
      };
    }

    it("asks for a nonce when a wallet redeems a pre-authorized code", async () => {
      const keyPair = await createTestDpopKeyPair();
      await runDpopNonceRoundTrip({
        kind: "authorization_server",
        accepts: hasStatus(200),
        prepare: async () =>
          tokenSender(
            keyPair,
            preAuthorizedTokenBody(await createPreAuthorizedCode())
          ),
      });
    });

    it("asks for a nonce at the credential endpoint", async () => {
      const keyPair = await createTestDpopKeyPair();
      const tokenResponse = await tokenSender(
        keyPair,
        preAuthorizedTokenBody(await createPreAuthorizedCode())
      )(await currentNonceFromServer(keyPair));
      await readAcceptedDpopNonce(tokenResponse, hasStatus(200));
      const { access_token } = (await tokenResponse.json()) as {
        access_token: string;
      };

      await runDpopNonceRoundTrip({
        kind: "resource_server",
        accepts: hasStatus(200),
        prepare: async () =>
          resourceSender(keyPair, access_token, {
            body: await credentialRequestBody(),
            handler: auth.handler,
            method: "POST",
            url: CREDENTIAL_URL,
          }),
      });
    });
  });

  /**
   * The nonce a client holds after one exchange with the server: what a
   * nonce-less proof is challenged with.
   */
  async function currentNonceFromServer(keyPair: DpopKeyPair) {
    const accessToken = await mintDpopBoundToken(keyPair, {
      scopes: ["openid"],
    });
    const response = await resourceSender(keyPair, accessToken, {
      handler: authRouteGet,
      method: "GET",
      url: USERINFO_URL,
    })(null);
    return readDpopNonceChallenge(response, "resource_server");
  }
});
