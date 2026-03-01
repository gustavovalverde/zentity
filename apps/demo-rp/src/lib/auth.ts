import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { account, session, user, verification } from "@/lib/db/schema";
import {
  currentClientIdKey,
  PROVIDER_IDS,
  type ProviderId,
  resolveClientId,
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

function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
  } catch {
    return {};
  }
}

async function fetchUserInfo(tokens: {
  accessToken?: string;
  idToken?: string;
}) {
  if (!tokens.accessToken) {
    throw new Error("No access token received from Zentity");
  }
  const response = await fetch(zentityUserInfoUrl(), {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Zentity userinfo (${response.status})`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const body =
    raw.response && typeof raw.response === "object"
      ? (raw.response as Record<string, unknown>)
      : raw;
  const id =
    (typeof body.sub === "string" && body.sub) ||
    (typeof body.id === "string" && body.id);
  if (!id) {
    throw new Error("Zentity userinfo response missing sub/id");
  }
  const profile: Record<string, unknown> = {
    ...body,
    id,
    emailVerified: Boolean(body.email_verified),
  };
  if (tokens.idToken) {
    Object.assign(profile, decodeIdTokenPayload(tokens.idToken));
  }
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

function createAuth() {
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
        config: [
          makeProviderConfig("zentity-bank", resolveClientId("bank"), [
            "openid",
            "email",
            "proof:verification",
          ]),
          makeProviderConfig("zentity-exchange", resolveClientId("exchange"), [
            "openid",
            "email",
            "proof:verification",
          ]),
          makeProviderConfig("zentity-wine", resolveClientId("wine"), [
            "openid",
            "email",
            "proof:age",
          ]),
          makeProviderConfig("zentity-aid", resolveClientId("aid"), [
            "openid",
            "email",
            "proof:verification",
          ]),
          makeProviderConfig("zentity-veripass", resolveClientId("veripass"), [
            "openid",
            "email",
            "proof:verification",
          ]),
        ],
      }),
    ],
  });
}

let _instance: ReturnType<typeof createAuth> | null = null;
let _cachedClientIds: string | undefined;

export function getAuth() {
  const key = currentClientIdKey();
  if (!_instance || key !== _cachedClientIds) {
    _cachedClientIds = key;
    _instance = createAuth();
  }
  return _instance;
}

export type Auth = ReturnType<typeof createAuth>;
