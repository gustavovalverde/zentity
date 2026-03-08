import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { getDb } from "@/lib/db/connection";
import { account, session, user, verification } from "@/lib/db/schema";
import {
  currentClientIdKey,
  PROVIDER_IDS,
  type ProviderId,
  readDcrClientId,
} from "@/lib/dcr";
import { env } from "@/lib/env";

function zentityUserInfoUrl() {
  return new URL("/api/auth/oauth2/userinfo", env.ZENTITY_URL).toString();
}

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
  new URL("/api/auth/pq-jwks", env.ZENTITY_URL)
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

async function fetchUserInfo(tokens: {
  accessToken?: string;
  idToken?: string;
}) {
  let body: Record<string, unknown> = {};

  // Try userinfo endpoint (may fail for privacy-preserving proof-only flows
  // where the access token record is ephemeral)
  if (tokens.accessToken) {
    const response = await fetch(zentityUserInfoUrl(), {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (response.ok) {
      body = (await response.json()) as Record<string, unknown>;
    }
  }

  // Merge id_token claims (always available, contains proof claims)
  if (tokens.idToken) {
    const idTokenClaims = await verifyIdToken(tokens.idToken);
    Object.assign(body, idTokenClaims);
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
  scopes: string[]
) {
  return {
    providerId,
    discoveryUrl: `${env.ZENTITY_URL}/.well-known/openid-configuration`,
    clientId,
    scopes,
    pkce: true,
    overrideUserInfo: true,
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
            makeProviderConfig(`zentity-${id}`, clientId, PROVIDER_SCOPES[id]),
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
