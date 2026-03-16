import "server-only";

import crypto from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

import { getDb } from "@/lib/db/connection";
import { account, session, user, verification } from "@/lib/db/schema";
import {
  currentClientIdKey,
  PROVIDER_IDS,
  type ProviderId,
  readDcrClientId,
} from "@/lib/dcr";
import { createDpopClient, type DpopClient } from "@/lib/dpop";
import { env } from "@/lib/env";

function zentityUserInfoUrl() {
  return new URL("/api/auth/oauth2/userinfo", env.ZENTITY_URL).toString();
}

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

const zentityJwks = createRemoteJWKSet(
  new URL("/api/auth/oauth2/jwks", env.ZENTITY_URL)
);

async function verifyIdToken(
  idToken: string
): Promise<Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(idToken, zentityJwks);
    return payload as Record<string, unknown>;
  } catch {
    return {};
  }
}

const ALG_TO_HASH: Record<string, string> = {
  RS256: "sha256",
  ES256: "sha256",
  PS256: "sha256",
  EdDSA: "sha512",
  "ML-DSA-65": "sha256",
};

function validateAtHash(accessToken: string, idToken: string, atHash: string) {
  try {
    const header = decodeProtectedHeader(idToken);
    const hashAlg = ALG_TO_HASH[header.alg ?? "RS256"] ?? "sha256";
    const hash = crypto
      .createHash(hashAlg)
      .update(accessToken, "ascii")
      .digest();
    const expected = hash.subarray(0, hash.length / 2).toString("base64url");
    if (atHash !== expected) {
      console.warn(
        "[demo-rp] at_hash mismatch: ID token is not bound to this access token",
        { expected, actual: atHash, alg: header.alg }
      );
    }
  } catch (e) {
    console.warn("[demo-rp] at_hash validation failed:", e);
  }
}

async function fetchUserInfo(tokens: {
  accessToken?: string;
  idToken?: string;
}) {
  let body: Record<string, unknown> = {};

  // Try userinfo endpoint with DPoP proof-of-possession
  if (tokens.accessToken) {
    const dpop = dpopClients.get(tokens.accessToken);
    dpopClients.delete(tokens.accessToken);

    const url = zentityUserInfoUrl();
    const headers: Record<string, string> = dpop
      ? {
          Authorization: `DPoP ${tokens.accessToken}`,
          DPoP: await dpop.proofFor("GET", url, tokens.accessToken),
        }
      : { Authorization: `Bearer ${tokens.accessToken}` };

    const response = await fetch(url, { headers });
    if (response.ok) {
      body = (await response.json()) as Record<string, unknown>;
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
  providerId: string,
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
    allClaims[providerId] = { ...allClaims[providerId], ...profile };
    await getDb()
      .update(user)
      .set({ claims: JSON.stringify(allClaims) })
      .where(eq(user.id, userId));
  } catch (e) {
    console.error("Failed to sync claims to DB:", e);
  }
}

function makeProviderConfig(
  providerId: string,
  clientId: string,
  scopes: string[],
  authorizationUrlParams?: Record<string, string>
) {
  return {
    providerId,
    discoveryUrl: `${env.ZENTITY_URL}/.well-known/openid-configuration`,
    clientId,
    scopes,
    pkce: true,
    overrideUserInfo: true,
    authorizationUrlParams: {
      resource: env.ZENTITY_URL,
      ...authorizationUrlParams,
    },
    async getToken(data: {
      code: string;
      redirectURI: string;
      codeVerifier?: string;
    }) {
      const tokenUrl = `${env.ZENTITY_URL}/api/auth/oauth2/token`;
      const dpop = await createDpopClient();
      const { result } = await dpop.withNonceRetry(async (nonce) => {
        const proof = await dpop.proofFor("POST", tokenUrl, undefined, nonce);
        const params: Record<string, string> = {
          grant_type: "authorization_code",
          code: data.code,
          redirect_uri: data.redirectURI,
          client_id: clientId,
          resource: env.ZENTITY_URL,
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
        return {
          response,
          result: (await response.json()) as Record<string, unknown>,
        };
      });
      const accessToken = result.access_token as string | undefined;
      if (accessToken) {
        dpopClients.set(accessToken, dpop);
      }
      return {
        accessToken,
        idToken: result.id_token as string | undefined,
        refreshToken: result.refresh_token as string | undefined,
        tokenType: result.token_type as string | undefined,
      };
    },
    async getUserInfo(tokens: { accessToken?: string; idToken?: string }) {
      const { id, profile } = await fetchUserInfo(tokens);
      await syncClaimsToDb(id, providerId, profile);
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
          [providerId]: { ...existingClaims[providerId], ...cleanProfile },
        },
      };
    },
  };
}

const PROVIDER_AUTH_PARAMS: Partial<
  Record<ProviderId, Record<string, string>>
> = {
  exchange: { acr_values: "urn:zentity:assurance:tier-2" },
  bank: { max_age: "300" },
};

const PROVIDER_SCOPES: Record<ProviderId, string[]> = {
  bank: ["openid", "email", "proof:verification"],
  exchange: ["openid", "email", "proof:verification"],
  wine: ["openid", "proof:age"],
  aid: ["openid", "email", "proof:verification"],
  veripass: ["openid", "proof:verification"],
  aether: ["openid", "email"],
};

function createAuth(clientIds: Partial<Record<ProviderId, string>>) {
  const registeredProviders = PROVIDER_IDS.filter((id) => clientIds[id]);

  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: { account, session, user, verification },
    }),
    baseURL: env.NEXT_PUBLIC_APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    account: {
      accountLinking: {
        trustedProviders: PROVIDER_IDS.map((id: ProviderId) => `zentity-${id}`),
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
        config: registeredProviders.flatMap((id) => {
          const clientId = clientIds[id];
          if (!clientId) {
            return [];
          }
          return [
            makeProviderConfig(
              `zentity-${id}`,
              clientId,
              PROVIDER_SCOPES[id],
              PROVIDER_AUTH_PARAMS[id]
            ),
          ];
        }),
      }),
    ],
  });
}

let _instance: ReturnType<typeof createAuth> | null = null;
let _cachedClientIds: string | undefined;

export async function getAuth() {
  const key = await currentClientIdKey();
  if (!_instance || key !== _cachedClientIds) {
    _cachedClientIds = key;
    const clientIds: Partial<Record<ProviderId, string>> = {};
    await Promise.all(
      PROVIDER_IDS.map(async (id) => {
        const clientId = await readDcrClientId(id);
        if (clientId) {
          clientIds[id] = clientId;
        }
      })
    );
    _instance = createAuth(clientIds);
  }
  return _instance;
}

export type Auth = ReturnType<typeof createAuth>;
