import type { OpaqueEndpointContext } from "@/lib/auth/plugins/opaque/types";

import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import {
  anonymous,
  genericOAuth,
  lastLoginMethod,
  magicLink,
  siwe,
  twoFactor,
} from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { SiweMessage } from "siwe";

import { getOnboardingContext } from "@/lib/auth/onboarding-context";
import { opaque } from "@/lib/auth/plugins/opaque/server";
import { db } from "@/lib/db/connection";
import { getVerificationStatus } from "@/lib/db/queries/identity";
import {
  deleteRecoveryGuardian,
  getRecoveryConfigByUserId,
  getRecoveryGuardianByType,
  getUserByRecoveryId,
} from "@/lib/db/queries/recovery";
import {
  accounts,
  passkeys,
  sessions,
  twoFactor as twoFactorTable,
  users,
  verifications,
  walletAddresses,
} from "@/lib/db/schema/auth";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "@/lib/db/schema/oauth-provider";
import { RECOVERY_GUARDIAN_TYPE_TWO_FACTOR } from "@/lib/recovery/constants";
import { getBetterAuthSecret, getOpaqueServerSetup } from "@/lib/utils/env";

const betterAuthSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  twoFactor: twoFactorTable,
  passkey: passkeys,
  walletAddress: walletAddresses,
  oauthClient: oauthClients,
  oauthRefreshToken: oauthRefreshTokens,
  oauthAccessToken: oauthAccessTokens,
  oauthConsent: oauthConsents,
};

// Build trusted origins based on environment
// In production: only the configured app URL + any explicit TRUSTED_ORIGINS
// In development: also trust all localhost variants (IPv4/IPv6)
const getTrustedOrigins = (): string[] => {
  const origins: string[] = [];

  const appUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    origins.push(appUrl);
  }

  // Allow additional trusted origins via env var (comma-separated)
  // Useful for local Docker development where NODE_ENV=production but localhost access is needed
  const additionalOrigins = process.env.TRUSTED_ORIGINS;
  if (additionalOrigins) {
    origins.push(
      ...additionalOrigins
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    );
  }

  // Node.js v17+ prefers IPv6, so browsers may access via [::1] instead of localhost
  // Add all localhost variants in development to handle IPv4/IPv6 resolution differences
  if (process.env.NODE_ENV !== "production") {
    origins.push(
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000"
    );
  }

  return origins;
};

const parseGenericOAuthConfig = () => {
  const raw = process.env.GENERIC_OAUTH_PROVIDERS;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const resolveLastLoginMethod = (ctx: { path?: string }): string | null => {
  const path = ctx.path ?? "";
  if (
    path.startsWith("/sign-in/magic-link") ||
    path.startsWith("/magic-link/verify")
  ) {
    return "magic-link";
  }
  if (path.startsWith("/sign-in/opaque/complete")) {
    return "opaque";
  }
  return null;
};

const resolveOpaqueUserByIdentifier = async (
  identifier: string,
  ctx: OpaqueEndpointContext
) => {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("@")) {
    return ctx.context.internalAdapter.findUserByEmail(normalized, {
      includeAccounts: true,
    });
  }

  const recoveryMatch = await getUserByRecoveryId(normalized);
  if (!recoveryMatch) {
    return null;
  }

  const user = await ctx.context.internalAdapter.findUserById(recoveryMatch.id);
  if (!user) {
    return null;
  }

  const accounts = await ctx.context.internalAdapter.findAccounts(user.id);
  return { user, accounts };
};

const getAuthDomain = (): string => {
  const base =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  try {
    return new URL(base).host;
  } catch {
    return "localhost:3000";
  }
};

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: betterAuthSchema,
  }),
  secret: getBetterAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: getTrustedOrigins(),
  rateLimit: {
    enabled: true,
    window: 60, // 1 minute window
    max: 100, // 100 requests per minute globally
    customRules: {
      // Stricter limits for authentication endpoints
      "/sign-in/opaque/challenge": {
        window: 60, // 1 minute
        max: 10, // 10 login attempts per minute
      },
      "/sign-in/opaque/complete": {
        window: 60, // 1 minute
        max: 10, // 10 login completions per minute
      },
      "/sign-up/opaque/challenge": {
        window: 60, // 1 minute
        max: 5, // 5 sign-up attempts per minute
      },
      "/sign-up/opaque/complete": {
        window: 60, // 1 minute
        max: 5, // 5 sign-up completions per minute
      },
      "/password/opaque/registration/challenge": {
        window: 60, // 1 minute
        max: 5, // 5 password set attempts per minute
      },
      "/password/opaque/registration/complete": {
        window: 60, // 1 minute
        max: 5, // 5 password set completions per minute
      },
      "/password/opaque/verify/challenge": {
        window: 60, // 1 minute
        max: 5, // 5 password verify attempts per minute
      },
      "/password/opaque/verify/complete": {
        window: 60, // 1 minute
        max: 5, // 5 password verify completions per minute
      },
      "/password-reset/opaque/request": {
        window: 300, // 5 minutes
        max: 3, // 3 password reset requests per 5 minutes
      },
      "/password-reset/opaque/challenge": {
        window: 60, // 1 minute
        max: 5, // 5 password reset challenges per minute
      },
      "/password-reset/opaque/complete": {
        window: 60, // 1 minute
        max: 5, // 5 password reset completions per minute
      },
    },
  },
  disabledPaths: [
    "/sign-in/email",
    "/sign-up/email",
    "/request-password-reset",
    "/reset-password",
    "/change-password",
    "/set-password",
    "/verify-password",
  ],
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  // OAuth providers for account linking (users must complete identity verification first)
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      // Enable account linking
      mapProfileToUser: (profile) => ({
        image: profile.picture,
      }),
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      // Enable account linking
      mapProfileToUser: (profile) => ({
        image: profile.avatar_url,
      }),
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    storeSessionInDatabase: true,
    // Cookie caching with JWE encryption for better performance.
    // Reduces database queries by caching session in encrypted cookies.
    // NOTE: Our passkey session creation now signs cookies correctly (HMAC-SHA256),
    // so this cache works properly with manually created sessions.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minute cache
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/two-factor/disable") {
        return;
      }
      const userId = ctx.context.session?.user?.id;
      if (!userId) {
        return;
      }
      const config = await getRecoveryConfigByUserId(userId);
      if (!config) {
        return;
      }
      const guardian = await getRecoveryGuardianByType({
        recoveryConfigId: config.id,
        guardianType: RECOVERY_GUARDIAN_TYPE_TWO_FACTOR,
      });
      if (guardian) {
        await deleteRecoveryGuardian(guardian.id);
      }
    }),
  },
  plugins: [
    nextCookies(),
    opaque({
      serverSetup: getOpaqueServerSetup(),
      resolveUserByIdentifier: resolveOpaqueUserByIdentifier,
      sendResetPassword: async ({ user: _user, url: _url }) => {
        // TODO: Implement email sending when SMTP is configured
        // For now, silently succeed - the user won't receive an email but can retry
      },
      revokeSessionsOnPasswordReset: true,
    }),
    anonymous({
      emailDomainName: process.env.ANONYMOUS_EMAIL_DOMAIN || "anon.zentity.app",
    }),
    magicLink({
      sendMagicLink: async ({ email: _email, url: _url }) => {
        // TODO: Implement email sending when SMTP is configured
        // For now, silently succeed - the user won't receive an email but can retry
      },
      expiresIn: 300, // 5 minutes
    }),
    passkey({
      origin: getTrustedOrigins(),
      registration: {
        requireSession: false,
        resolveUser: async ({ context }) => {
          if (!context) {
            throw new Error("Missing onboarding context token.");
          }
          const onboardingContext = await getOnboardingContext(context);
          if (!onboardingContext?.userId) {
            throw new Error("Onboarding context expired or invalid.");
          }
          const user = await db.query.users.findFirst({
            where: eq(users.id, onboardingContext.userId),
          });
          if (!user) {
            throw new Error("Onboarding user not found.");
          }
          const name = onboardingContext.email || user.email || user.id;
          return { id: user.id, name, displayName: name };
        },
        afterVerification: async ({ ctx, user, context }) => {
          if (!context) {
            throw new Error("Missing onboarding context token.");
          }
          const onboardingContext = await getOnboardingContext(context);
          if (!onboardingContext) {
            throw new Error("Onboarding context expired or invalid.");
          }
          if (onboardingContext.userId !== user.id) {
            throw new Error("Onboarding context user mismatch.");
          }

          if (onboardingContext.email) {
            await ctx.context.internalAdapter.updateUser(user.id, {
              email: onboardingContext.email,
              isAnonymous: false,
            });
          } else {
            await ctx.context.internalAdapter.updateUser(user.id, {
              isAnonymous: false,
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id
          );
          if (!session) {
            throw new Error("Failed to create session.");
          }
          const storedUser = await ctx.context.internalAdapter.findUserById(
            user.id
          );
          if (!storedUser) {
            throw new Error("User not found.");
          }
          await setSessionCookie(ctx, { session, user: storedUser });
          return { userId: user.id };
        },
      },
    }),
    siwe({
      domain: getAuthDomain(),
      emailDomainName: process.env.SIWE_EMAIL_DOMAIN || "wallet.zentity.app",
      anonymous: true,
      getNonce: async () => crypto.randomUUID(),
      verifyMessage: async ({
        message,
        signature,
        address,
        chainId,
        cacao,
      }) => {
        const siweMessage = new SiweMessage(message);
        const result = await siweMessage.verify({
          signature,
          domain: cacao?.p?.domain || getAuthDomain(),
          nonce: cacao?.p?.nonce || siweMessage.nonce,
        });
        return (
          result.success &&
          siweMessage.address?.toLowerCase() === address.toLowerCase() &&
          (siweMessage.chainId ? siweMessage.chainId === chainId : true)
        );
      },
    }),
    genericOAuth({
      config: parseGenericOAuthConfig(),
    }),
    lastLoginMethod({
      customResolveMethod: resolveLastLoginMethod,
    }),
    oauthProvider({
      scopes: ["openid", "verification"],
      disableJwtPlugin: true,
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      customUserInfoClaims: async ({ user, scopes }) => {
        if (!scopes.includes("verification")) {
          return {};
        }
        const verification = await getVerificationStatus(user.id);
        return { verification };
      },
    }),
    // Two-factor authentication (TOTP) as optional backup for password users
    // Note: TOTP cannot replace passkey for FHE key access
    twoFactor({
      issuer: "Zentity",
      allowPasswordless: true,
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
