import "server-only";

import crypto from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  createDpopClient,
  createOpenIdTokenVerifier,
  type DpopClient,
  fetchUserInfo,
} from "@zentity/sdk/rp";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { decodeProtectedHeader } from "jose";

import { getDb } from "@/lib/db/connection";
import {
  account,
  oauthDpopKey,
  session,
  user,
  verification,
} from "@/lib/db/schema";
import { readDcrClientId } from "@/lib/dcr";
import { env } from "@/lib/env";
import {
  describeOAuthErrorResponse,
  parseOAuthJsonResponse,
} from "@/lib/oauth-response";
import {
  ROUTE_SCENARIO_IDS,
  ROUTE_SCENARIOS,
  type RouteScenarioId,
} from "@/scenarios/route-scenario-registry";
import type { RouteScenario } from "@/scenarios/route-scenario";

// Store DPoP clients by access token so getUserInfo can reuse the same
// keypair that getToken bound the token to (cnf.jkt).
const dpopClients = new Map<string, DpopClient>();

const STRIP_FIELDS = new Set([
  "is_anonymous",
  "isAnonymous",
  "two_factor_enabled",
  "twoFactorEnabled",
  "passwordless_signup",
  "passwordlessSignup",
]);

function stripProviderFields(obj: Record<string, unknown>) {
  for (const key of STRIP_FIELDS) {
    delete obj[key];
  }
  return obj;
}

// Keep verifier construction lazy because this module is imported during
// Next.js build steps where env defaults may be skipped.
let idTokenVerifier: ReturnType<typeof createOpenIdTokenVerifier> | undefined;
function getIdTokenVerifier() {
  idTokenVerifier ??= createOpenIdTokenVerifier({
    issuerUrl: env.ZENTITY_URL,
  });
  return idTokenVerifier;
}

async function verifyIdToken(
  idToken: string
): Promise<Record<string, unknown>> {
  const { payload } = await getIdTokenVerifier().verify(idToken);
  return payload as Record<string, unknown>;
}

const ALG_TO_HASH: Record<string, string> = {
  RS256: "sha256",
  ES256: "sha256",
  PS256: "sha256",
  EdDSA: "sha512",
  "ML-DSA-65": "sha256",
};

function validateAtHash(accessToken: string, idToken: string, atHash: string) {
  const header = decodeProtectedHeader(idToken);
  const hashAlg = ALG_TO_HASH[header.alg ?? "RS256"] ?? "sha256";
  const hash = crypto.createHash(hashAlg).update(accessToken, "ascii").digest();
  const expected = hash.subarray(0, hash.length / 2).toString("base64url");

  if (atHash !== expected) {
    throw new Error("ID token at_hash mismatch");
  }
}

function toExpiryDate(seconds: unknown): Date | undefined {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return undefined;
  }

  return new Date(Date.now() + seconds * 1000);
}

async function buildOAuthProfile(tokens: {
  accessToken?: string | undefined;
  idToken?: string | undefined;
}) {
  let body: Record<string, unknown> = {};

  if (tokens.accessToken) {
    const dpop = dpopClients.get(tokens.accessToken);
    dpopClients.delete(tokens.accessToken);
    const userInfo = await fetchUserInfo({
      accessToken: tokens.accessToken,
      ...(dpop ? { dpopClient: dpop } : {}),
      unwrapResponseEnvelope: false,
      userInfoUrl: new URL("/api/auth/oauth2/userinfo", env.ZENTITY_URL),
    });
    if (userInfo) {
      body = userInfo;
    }
  }

  // Merge id_token claims (proof/assurance claims only — PII comes from userinfo)
  if (tokens.idToken) {
    const idTokenClaims = await verifyIdToken(tokens.idToken);

    // Validate at_hash binding (OIDC Core §3.1.3.6)
    if (tokens.accessToken && typeof idTokenClaims.at_hash === "string") {
      validateAtHash(tokens.accessToken, tokens.idToken, idTokenClaims.at_hash);
    }

    // id_token as base, userinfo on top — userinfo wins for identity PII
    body = { ...idTokenClaims, ...body };
  }

  const id =
    (typeof body.sub === "string" && body.sub) ||
    (typeof body.id === "string" && body.id);
  if (!id) {
    throw new Error("Zentity response missing sub/id");
  }

  const profile: Record<string, unknown> = {
    ...body,
    id,
    emailVerified: Boolean(body.email_verified),
  };
  stripProviderFields(profile);
  return { id, profile };
}

async function findUserIdByAccountId(
  accountId: string
): Promise<string | null> {
  try {
    const row = await getDb().query.account.findFirst({
      where: eq(account.accountId, accountId),
      columns: { userId: true },
    });
    return row?.userId ?? null;
  } catch (e) {
    console.error("Failed to find user by account ID:", e);
    return null;
  }
}

async function readExistingClaims(
  accountId: string
): Promise<Record<string, Record<string, unknown>>> {
  try {
    const userId = await findUserIdByAccountId(accountId);
    if (!userId) {
      return {};
    }
    const row = await getDb().query.user.findFirst({
      where: eq(user.id, userId),
      columns: { claims: true },
    });
    if (row?.claims) {
      return JSON.parse(row.claims);
    }
  } catch (e) {
    console.error("Failed to read existing claims:", e);
  }
  return {};
}

async function syncClaimsToDb(
  accountId: string,
  oauthProviderId: string,
  profile: Record<string, unknown>
) {
  try {
    const userId = await findUserIdByAccountId(accountId);
    if (!userId) {
      return;
    }
    const row = await getDb().query.user.findFirst({
      where: eq(user.id, userId),
      columns: { claims: true },
    });
    const allClaims = row?.claims ? JSON.parse(row.claims) : {};
    allClaims[oauthProviderId] = {
      ...allClaims[oauthProviderId],
      ...profile,
    };
    await getDb()
      .update(user)
      .set({ claims: JSON.stringify(allClaims) })
      .where(eq(user.id, userId));
  } catch (e) {
    console.error("Failed to sync claims to DB:", e);
  }
}

function makeProviderConfig(
  oauthProviderId: string,
  clientId: string,
  scopes: string[],
  authorizationUrlParams?: Record<string, string>
) {
  return {
    providerId: oauthProviderId,
    discoveryUrl: `${env.ZENTITY_URL}/.well-known/openid-configuration`,
    clientId,
    scopes,
    pkce: true,
    overrideUserInfo: true,
    authorizationUrlParams,
    async getToken(data: {
      code: string;
      redirectURI: string;
      codeVerifier?: string | undefined;
    }) {
      const tokenUrl = `${env.ZENTITY_URL}/api/auth/oauth2/token`;
      const dpop = await createDpopClient();
      const { response, result } = await dpop.withNonceRetry(async (nonce) => {
        const proof = await dpop.proofFor("POST", tokenUrl, undefined, nonce);
        const params: Record<string, string> = {
          grant_type: "authorization_code",
          code: data.code,
          redirect_uri: data.redirectURI,
          client_id: clientId,
        };
        if (data.codeVerifier) {
          params.code_verifier = data.codeVerifier;
        }
        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            DPoP: proof,
          },
          body: new URLSearchParams(params),
        });
        const needsNonceRetry =
          (response.status === 400 || response.status === 401) &&
          Boolean(response.headers.get("DPoP-Nonce"));
        return {
          response,
          result: needsNonceRetry
            ? {}
            : await parseOAuthJsonResponse(response, "OAuth token exchange"),
        };
      });
      if (!response.ok) {
        throw new Error(
          describeOAuthErrorResponse(response, result, "OAuth token exchange")
        );
      }
      const accessToken = result.access_token as string | undefined;
      if (accessToken) {
        dpopClients.set(accessToken, dpop);
        await getDb()
          .insert(oauthDpopKey)
          .values({
            id: crypto.randomUUID(),
            oauthProviderId,
            accessToken,
            publicJwk: JSON.stringify(dpop.keyPair.publicJwk),
            privateJwk: JSON.stringify(dpop.keyPair.privateJwk),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: oauthDpopKey.accessToken,
            set: {
              oauthProviderId,
              publicJwk: JSON.stringify(dpop.keyPair.publicJwk),
              privateJwk: JSON.stringify(dpop.keyPair.privateJwk),
              updatedAt: new Date(),
            },
          });
      }
      return {
        accessToken,
        accessTokenExpiresAt: toExpiryDate(result.expires_in),
        idToken: result.id_token as string | undefined,
        refreshToken: result.refresh_token as string | undefined,
        refreshTokenExpiresAt: toExpiryDate(result.refresh_token_expires_in),
        tokenType: result.token_type as string | undefined,
      };
    },
    async getUserInfo(tokens: {
      accessToken?: string | undefined;
      idToken?: string | undefined;
    }) {
      const { id, profile } = await buildOAuthProfile(tokens);
      await syncClaimsToDb(id, oauthProviderId, profile);
      profile.__existingClaims = await readExistingClaims(id);
      return profile as { id: string; emailVerified: boolean };
    },
    mapProfileToUser(profile: Record<string, unknown>) {
      const existingClaims = (profile.__existingClaims ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const { __existingClaims: _, ...cleanProfile } = profile;

      const subject =
        (typeof profile.sub === "string" && profile.sub) ||
        (typeof profile.id === "string" && profile.id) ||
        undefined;
      const name =
        (profile.name as string) ||
        [profile.given_name, profile.family_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        (profile.preferred_username as string) ||
        subject ||
        "Zentity user";
      const email =
        (profile.email as string) ||
        (subject ? `${subject}@zentity.local` : "unknown@zentity.local");
      return {
        name,
        email,
        emailVerified: profile.email_verified as boolean,
        image: profile.picture as string,
        claims: {
          ...existingClaims,
          [oauthProviderId]: {
            ...existingClaims[oauthProviderId],
            ...cleanProfile,
          },
        },
      };
    },
  };
}

function buildAuthorizationUrlParams(
  scenario: RouteScenario
): Record<string, string> | undefined {
  const params: Record<string, string> = {};

  if (scenario.acrValues) {
    params.acr_values = scenario.acrValues;
  }

  if (scenario.maxAge) {
    params.max_age = String(scenario.maxAge);
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function createAuth(clientIds: Partial<Record<RouteScenarioId, string>>) {
  const registeredScenarios = ROUTE_SCENARIOS.filter(
    (scenario) => clientIds[scenario.id]
  );

  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: { account, session, user, verification },
    }),
    baseURL: env.NEXT_PUBLIC_APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    account: {
      accountLinking: {
        trustedProviders: ROUTE_SCENARIOS.map(
          (scenario) => scenario.oauthProviderId
        ),
      },
    },
    advanced: {
      cookiePrefix: "demo-rp",
    },
    user: {
      additionalFields: {
        claims: { type: "json", required: false },
      },
    },
    plugins: [
      nextCookies(),
      genericOAuth({
        config: registeredScenarios.flatMap((scenario) => {
          const clientId = clientIds[scenario.id];
          if (!clientId) {
            return [];
          }
          return [
            makeProviderConfig(
              scenario.oauthProviderId,
              clientId,
              scenario.signInScopes,
              buildAuthorizationUrlParams(scenario)
            ),
          ];
        }),
      }),
    ],
  });
}

export async function getAuth() {
  const clientIds: Partial<Record<RouteScenarioId, string>> = {};
  await Promise.all(
    ROUTE_SCENARIO_IDS.map(async (id) => {
      const clientId = await readDcrClientId(id);
      if (clientId) {
        clientIds[id] = clientId;
      }
    })
  );
  return createAuth(clientIds);
}

export type Auth = ReturnType<typeof createAuth>;
