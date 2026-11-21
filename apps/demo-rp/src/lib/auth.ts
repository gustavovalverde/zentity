import "server-only";

import crypto from "node:crypto";
import { defineRequestState } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createOpenIdTokenVerifier, fetchUserInfo } from "@zentity/sdk/rp";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import type { DpopKeyPair } from "better-auth/oauth2/dpop-client";
import { genericOAuth } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import { decodeProtectedHeader } from "jose";

import { getDb } from "@/lib/db/connection";
import { account, session, user, verification } from "@/lib/db/schema";
import { readDcrClient } from "@/lib/dcr";
import { env } from "@/lib/env";
import {
  getOAuthDpopClient,
  getOAuthDpopKeyPair,
} from "@/lib/oauth-dpop-client";
import type { RouteScenario } from "@/scenarios/route-scenario";
import {
  ROUTE_SCENARIO_IDS,
  ROUTE_SCENARIOS,
  type RouteScenarioId,
} from "@/scenarios/route-scenario-registry";

const STRIP_FIELDS = new Set([
  "is_anonymous",
  "isAnonymous",
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

async function buildOAuthProfile(tokens: {
  accessToken?: string | undefined;
  idToken?: string | undefined;
}) {
  let body: Record<string, unknown> = {};

  if (tokens.accessToken) {
    const userInfo = await fetchUserInfo({
      accessToken: tokens.accessToken,
      dpopClient: await getOAuthDpopClient(),
      unwrapResponseEnvelope: false,
      userInfoUrl: new URL("/api/auth/oauth2/userinfo", env.ZENTITY_URL),
    });
    if (!userInfo) {
      console.error("Zentity userinfo request failed");
      return null;
    }
    body = userInfo;
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

  const profile = {
    ...body,
    id,
    emailVerified: Boolean(body.email_verified),
  };
  stripProviderFields(profile);
  return profile;
}

const pendingProfile = defineRequestState<{
  providerId: string;
  profile: Record<string, unknown>;
} | null>(() => null);

async function saveAccountClaims(linked: {
  userId: string;
  providerId: string;
  accountId: string;
}) {
  const pending = await pendingProfile.get();
  if (
    pending?.providerId !== linked.providerId ||
    pending.profile.id !== linked.accountId
  ) {
    return;
  }

  const db = getDb();
  const owner = eq(user.id, linked.userId);
  const path = `$.${JSON.stringify(linked.providerId)}`;
  const profiles = sql`CASE WHEN json_valid(${user.claims}) AND json_type(${user.claims}) = 'object' THEN ${user.claims} ELSE '{}' END`;
  const stored = sql<string | null>`(${profiles}) -> ${path}`;

  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: a conflicting callback requires a fresh read of this provider's disclosures.
    const row = await db
      .select({ profile: stored })
      .from(user)
      .where(owner)
      .get();
    if (!row) {
      throw new Error("The linked account's user no longer exists");
    }
    const previous: Record<string, unknown> | null = row.profile
      ? JSON.parse(row.profile)
      : null;
    const profile =
      (previous?.sub ?? previous?.id) === linked.accountId
        ? { ...previous, ...pending.profile }
        : pending.profile;

    const result = await db
      .update(user)
      .set({
        claims: sql`json_set(${profiles}, ${path}, json(${JSON.stringify(profile)}))`,
      })
      .where(and(owner, sql`${stored} IS ${row.profile}`))
      .catch(() => {
        // Drizzle errors include the bound profile in their query parameters.
        throw new Error("Could not save claims for the linked account");
      });
    if (result.rowsAffected > 0) {
      return;
    }
  }
}

function makeProviderConfig(
  oauthProviderId: string,
  scenarioId: RouteScenarioId,
  clientId: string,
  clientSecret: string,
  scopes: string[],
  dpopKeyPair: DpopKeyPair,
  authorizationUrlParams?: Record<string, string>
) {
  return {
    providerId: oauthProviderId,
    // Zentity's issuer is `${ZENTITY_URL}/api/auth`, and generic-oauth refuses
    // a document whose issuer the discovery URL does not name.
    discoveryUrl: `${env.ZENTITY_URL}/api/auth/.well-known/openid-configuration`,
    clientId,
    clientSecret,
    tokenEndpointAuth: { method: "client_secret_basic" as const },
    postLogoutRedirectURI: `${env.NEXT_PUBLIC_APP_URL}/${scenarioId}`,
    scopes,
    pkce: true,
    dpop: { keyPair: dpopKeyPair },
    // "auto" pushes only if Zentity's discovery starts requiring PAR. Zentity's
    // PAR hook requires a resource indicator, and a resource-bound token would
    // change the audience that userinfo and the agent token exchange expect.
    pushedAuthorizationRequest: "auto" as const,
    overrideUserInfo: true,
    authorizationUrlParams,
    getUserInfo: buildOAuthProfile,
    async mapProfileToUser(profile: Record<string, unknown>) {
      await pendingProfile.set({ providerId: oauthProviderId, profile });
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

function createAuth(
  clients: Partial<
    Record<RouteScenarioId, { clientId: string; clientSecret: string }>
  >,
  dpopKeyPair: DpopKeyPair
) {
  const registeredScenarios = ROUTE_SCENARIOS.filter(
    (scenario) => clients[scenario.id]
  );

  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: { account, session, user, verification },
    }),
    databaseHooks: {
      account: {
        create: { after: saveAccountClaims },
        update: { after: saveAccountClaims },
      },
    },
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
        claims: { type: "json", required: false, input: false },
      },
    },
    plugins: [
      nextCookies(),
      genericOAuth({
        config: registeredScenarios.flatMap((scenario) => {
          const client = clients[scenario.id];
          if (!client) {
            return [];
          }
          return [
            makeProviderConfig(
              scenario.oauthProviderId,
              scenario.id,
              client.clientId,
              client.clientSecret,
              scenario.signInScopes,
              dpopKeyPair,
              buildAuthorizationUrlParams(scenario)
            ),
          ];
        }),
      }),
    ],
  });
}

export async function getAuth() {
  const clients: Partial<
    Record<RouteScenarioId, { clientId: string; clientSecret: string }>
  > = {};
  const [dpopKeyPair] = await Promise.all([
    getOAuthDpopKeyPair(),
    ...ROUTE_SCENARIO_IDS.map(async (id) => {
      const client = await readDcrClient(id);
      if (client?.clientSecret) {
        clients[id] = {
          clientId: client.clientId,
          clientSecret: client.clientSecret,
        };
      }
    }),
  ]);
  return createAuth(clients, dpopKeyPair);
}

export type Auth = ReturnType<typeof createAuth>;
