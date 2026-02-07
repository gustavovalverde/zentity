import type { OpaqueEndpointContext } from "@/lib/auth/plugins/opaque/types";

import { oauthProvider } from "@better-auth/oauth-provider";
import { oidc4ida } from "@better-auth/oidc4ida";
import { type Oidc4vciOptions, oidc4vci } from "@better-auth/oidc4vci";
import { oidc4vp } from "@better-auth/oidc4vp";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import {
  anonymous,
  genericOAuth,
  jwt,
  lastLoginMethod,
  magicLink,
  siwe,
  twoFactor,
} from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { eq } from "drizzle-orm";
import { SiweMessage } from "siwe";

import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import {
  buildIdentityClaims,
  buildOidcVerifiedClaims,
  buildVcClaims,
  VC_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/claims";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
  IDENTITY_SCOPE_CLAIMS,
  IDENTITY_SCOPES,
} from "@/lib/auth/oidc/identity-scopes";
import {
  extractVcScopes,
  filterVcClaimsByScopes,
  VC_SCOPES,
} from "@/lib/auth/oidc/vc-scopes";
import { opaque } from "@/lib/auth/plugins/opaque/server";
import { db } from "@/lib/db/connection";
import {
  deleteOAuthIdentityData,
  getOAuthIdentityData,
  upsertOAuthIdentityData,
} from "@/lib/db/queries/oauth-identity";
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
import { jwks } from "@/lib/db/schema/jwks";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "@/lib/db/schema/oauth-provider";
import { oidc4idaVerifiedClaims } from "@/lib/db/schema/oidc4ida";
import {
  oidc4vciIssuedCredentials,
  oidc4vciOffers,
} from "@/lib/db/schema/oidc4vci";
import {
  invitations,
  members,
  organizations,
} from "@/lib/db/schema/organization";
import {
  decryptIdentityFromServer,
  encryptIdentityForServer,
} from "@/lib/privacy/server-encryption/identity";
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
  organization: organizations,
  member: members,
  invitation: invitations,
  jwks,
  oidc4idaVerifiedClaim: oidc4idaVerifiedClaims,
  oidc4vciOffer: oidc4vciOffers,
  oidc4vciIssuedCredential: oidc4vciIssuedCredentials,
};

// Build trusted origins based on environment
// In production: only the configured app URL + any explicit TRUSTED_ORIGINS
// In development: also trust all localhost variants (IPv4/IPv6)
const getAppOrigin = (): string => {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  try {
    return new URL(base).origin;
  } catch {
    return "http://localhost:3000";
  }
};

const getTrustedOrigins = (): string[] => {
  const origins: string[] = [];

  const appOrigin = getAppOrigin();
  if (appOrigin) {
    origins.push(appOrigin);
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
  // Also add host.docker.internal for Docker container interoperability (demo stack, walt.id, etc.)
  if (process.env.NODE_ENV !== "production") {
    origins.push(
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://host.docker.internal:3000"
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

const getAuthDomain = (): string => new URL(getAppOrigin()).host;

const authIssuer = getAuthIssuer();
const oidc4vciCredentialAudience = `${authIssuer}/oidc4vci/credential`;
const rpApiAudience = `${authIssuer}/resource/rp-api`;
const identityClaimKeys = Array.from(
  new Set(Object.values(IDENTITY_SCOPE_CLAIMS).flat())
);
const publicClientScopes = [
  "openid",
  "profile",
  "email",
  "vc:identity",
  ...VC_SCOPES,
  ...IDENTITY_SCOPES,
];
const oidcStandardClaims = [
  "sub",
  "name",
  "given_name",
  "family_name",
  "birthdate",
  "address",
  "email",
  "email_verified",
  "picture",
  "updated_at",
];
const advertisedClaims = Array.from(
  new Set([...oidcStandardClaims, ...VC_DISCLOSURE_KEYS, ...identityClaimKeys])
);
const isOidcE2e = process.env.E2E_OIDC_ONLY === "true";
const oidc4vciCredentialConfigurations = [
  {
    id: "zentity_identity",
    // Using HTTP URL format for VCT to support wallet interoperability (e.g., walt.id)
    // Some wallets expect to resolve VCT URLs to fetch type metadata
    vct: `${authIssuer}/vct/zentity_identity`,
    format: "dc+sd-jwt" as const,
    sdJwt: {
      disclosures: [...VC_DISCLOSURE_KEYS],
      decoyCount: 0,
    },
  },
  ...(isOidcE2e
    ? [
        {
          id: "zentity_identity_deferred",
          vct: `${authIssuer}/vct/zentity_identity:deferred`,
          format: "dc+sd-jwt" as const,
          sdJwt: {
            disclosures: [...VC_DISCLOSURE_KEYS],
            decoyCount: 0,
          },
        },
      ]
    : []),
] satisfies Oidc4vciOptions["credentialConfigurations"];

const oidc4vciDeferredIssuance = isOidcE2e
  ? {
      shouldDefer: async ({
        credentialConfigurationId,
      }: {
        credentialConfigurationId: string;
      }) => credentialConfigurationId === "zentity_identity_deferred",
      intervalSeconds: 5,
      transactionExpiresInSeconds: 600,
    }
  : undefined;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: betterAuthSchema,
  }),
  secret: getBetterAuthSecret(),
  baseURL: authIssuer,
  trustedOrigins: getTrustedOrigins(),
  rateLimit: isOidcE2e
    ? { enabled: false }
    : {
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
  disabledPaths: isOidcE2e
    ? []
    : [
        "/sign-in/email",
        "/sign-up/email",
        "/request-password-reset",
        "/reset-password",
        "/change-password",
        "/set-password",
        "/verify-password",
      ],
  emailAndPassword: isOidcE2e ? { enabled: true } : { enabled: false },
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
    before: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path !== "/oauth2/delete-consent" &&
        ctx.path !== "/oauth2/update-consent"
      ) {
        return;
      }

      const consentId =
        typeof ctx.body?.id === "string" && ctx.body.id.trim().length > 0
          ? ctx.body.id.trim()
          : null;
      if (!consentId) {
        return;
      }

      const consent = await db
        .select({
          id: oauthConsents.id,
          userId: oauthConsents.userId,
          clientId: oauthConsents.clientId,
        })
        .from(oauthConsents)
        .where(eq(oauthConsents.id, consentId))
        .limit(1)
        .get();

      if (!(consent?.userId && consent?.clientId)) {
        return;
      }

      return {
        context: {
          zentityConsentCleanup: {
            userId: consent.userId,
            clientId: consent.clientId,
          },
        },
      };
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/two-factor/disable") {
        // fallthrough: other after-hooks below
      } else {
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
        return;
      }

      // Consent revocation hygiene for identity.* data (RFC-0025).
      // When consents are deleted or reduced, remove or re-filter stored identity blob.
      if (
        ctx.path !== "/oauth2/delete-consent" &&
        ctx.path !== "/oauth2/update-consent"
      ) {
        return;
      }

      const cleanup = (
        ctx.context as unknown as {
          zentityConsentCleanup?: { userId: string; clientId: string };
        }
      ).zentityConsentCleanup;
      if (!cleanup) {
        return;
      }

      if (ctx.path === "/oauth2/delete-consent") {
        await deleteOAuthIdentityData(cleanup.userId, cleanup.clientId);
        return;
      }

      if (ctx.path === "/oauth2/update-consent") {
        const returned = ctx.context.returned as
          | { scopes?: unknown; userId?: unknown; clientId?: unknown }
          | undefined;
        const nextScopes = Array.isArray(returned?.scopes)
          ? (returned?.scopes as string[]).filter((s) => typeof s === "string")
          : [];

        const identityScopes = extractIdentityScopes(nextScopes);
        if (identityScopes.length === 0) {
          await deleteOAuthIdentityData(cleanup.userId, cleanup.clientId);
          return;
        }

        const existing = await getOAuthIdentityData(
          cleanup.userId,
          cleanup.clientId
        );
        if (!existing) {
          return;
        }

        const decrypted = await decryptIdentityFromServer(
          existing.encryptedBlob,
          cleanup
        );
        const filtered = filterIdentityByScopes(decrypted, nextScopes);
        const reEncrypted = await encryptIdentityForServer(filtered, cleanup);

        await upsertOAuthIdentityData({
          id: existing.id,
          userId: cleanup.userId,
          clientId: cleanup.clientId,
          encryptedBlob: reEncrypted,
          consentedScopes: nextScopes,
          capturedAt: existing.capturedAt ?? new Date().toISOString(),
          expiresAt: existing.expiresAt ?? null,
        });
      }
      return;
    }),
  },
  plugins: [
    nextCookies(),
    opaque({
      serverSetup: getOpaqueServerSetup,
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
      },
    }),
    organization({
      creatorRole: "owner",
    }),
    siwe({
      domain: getAuthDomain(),
      emailDomainName: process.env.SIWE_EMAIL_DOMAIN || "wallet.zentity.app",
      anonymous: true,
      // SIWE nonce must be alphanumeric only (EIP-4361 ABNF: 8*( ALPHA / DIGIT ))
      // Using hex encoding of random bytes to ensure compliance
      getNonce: async () => crypto.randomUUID().replaceAll("-", ""),
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
    jwt({
      jwt: {
        issuer: authIssuer,
      },
    }),
    oauthProvider({
      scopes: [
        // Standard OIDC scopes
        "openid",
        "profile",
        "email",
        "offline_access",
        // VC verification status scopes (no PII — derived booleans only)
        "vc:identity", // Umbrella: all verification claims
        ...VC_SCOPES, // Granular: vc:verification, vc:age, vc:document, etc.
        // RP compliance key management (client_credentials)
        "compliance:key:read",
        "compliance:key:write",
        // Identity data scopes — actual PII (RFC-0025)
        "identity.name", // given_name, family_name, name
        "identity.dob", // birthdate
        "identity.address", // address (OIDC standard format)
        "identity.document", // document_number, document_type, issuing_country
        "identity.nationality", // nationality, nationalities
      ],
      grantTypes: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      ],
      validAudiences: [authIssuer, oidc4vciCredentialAudience, rpApiAudience],
      // Enable RFC 7591 Dynamic Client Registration for OIDC4VCI wallets
      // Wallets can self-register via POST /api/auth/oauth/register
      allowDynamicClientRegistration: true,
      // Allow public clients (no client_secret) - required for mobile/browser wallets
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: publicClientScopes,
      clientRegistrationAllowedScopes: publicClientScopes,
      clientReference: ({ session }) =>
        typeof session?.activeOrganizationId === "string"
          ? session.activeOrganizationId
          : undefined,
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      advertisedMetadata: {
        claims_supported: advertisedClaims,
      },
      customUserInfoClaims: async ({ user, scopes, jwt }) => {
        const scopeList: string[] = Array.isArray(scopes) ? scopes : [];
        const claims: Record<string, unknown> = {};

        // VC verification claims — filtered by granular vc:* sub-scopes
        const hasVcScopes =
          scopeList.includes("vc:identity") ||
          extractVcScopes(scopeList).length > 0;
        if (hasVcScopes) {
          const allVcClaims = await buildVcClaims(user.id);
          Object.assign(claims, filterVcClaimsByScopes(allVcClaims, scopeList));
        }

        // Identity PII claims — filtered by identity.* sub-scopes
        const requestedIdentityScopes = extractIdentityScopes(scopeList);
        const clientId =
          (jwt?.azp as string | undefined) ??
          (jwt?.client_id as string | undefined);
        if (clientId && requestedIdentityScopes.length > 0) {
          const identityClaims = await buildIdentityClaims(user.id, clientId);
          if (identityClaims) {
            Object.assign(
              claims,
              filterIdentityByScopes(identityClaims, scopeList)
            );
          }
        }

        return claims;
      },
    }),
    oidc4ida({
      getVerifiedClaims: async ({ user }: { user: { id: string } }) =>
        buildOidcVerifiedClaims(user.id),
    }),
    oidc4vci({
      defaultWalletClientId:
        process.env.OIDC4VCI_WALLET_CLIENT_ID || "zentity-wallet",
      credentialIssuer: authIssuer,
      issuerBaseURL: authIssuer,
      credentialAudience: oidc4vciCredentialAudience,
      authorizationServer: authIssuer,
      credentialConfigurations: oidc4vciCredentialConfigurations,
      resolveClaims: async ({ user }: { user: { id: string } }) =>
        buildVcClaims(user.id),
      ...(oidc4vciDeferredIssuance
        ? { deferredIssuance: oidc4vciDeferredIssuance }
        : {}),
    }),
    oidc4vp({
      expectedAudience: authIssuer,
      allowedIssuers: [authIssuer],
      resolveIssuerJwks: async (issuer: string) => {
        const jwksUrl =
          process.env.OIDC4VP_JWKS_URL || joinAuthIssuerPath(issuer, "jwks");
        const response = await fetch(jwksUrl);
        if (!response.ok) {
          throw new Error("Unable to resolve issuer JWKS");
        }
        const body = (await response.json()) as { keys?: unknown };
        return Array.isArray(body.keys)
          ? (body.keys as Record<string, unknown>[])
          : [];
      },
      verifyStatusList: true,
      requiredClaimKeys: ["verification_level", "verified"],
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
