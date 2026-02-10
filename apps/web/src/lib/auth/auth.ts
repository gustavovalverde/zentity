import type { OpaqueEndpointContext } from "@/lib/auth/plugins/opaque/types";

import { oauthProvider } from "@better-auth/oauth-provider";
import { oidc4ida } from "@better-auth/oidc4ida";
import { type Oidc4vciOptions, oidc4vci } from "@better-auth/oidc4vci";
import { oidc4vp } from "@better-auth/oidc4vp";
import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import {
  anonymous,
  genericOAuth,
  jwt,
  lastLoginMethod,
  magicLink,
  twoFactor,
} from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";

import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import {
  buildOidcVerifiedClaims,
  buildProofClaims,
  PROOF_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/claims";
import { consumeEphemeralClaims } from "@/lib/auth/oidc/ephemeral-identity-claims";
import {
  filterIdentityByScopes,
  IDENTITY_SCOPE_CLAIMS,
  IDENTITY_SCOPES,
  isIdentityScope,
} from "@/lib/auth/oidc/identity-scopes";
import {
  extractProofScopes,
  filterProofClaimsByScopes,
  PROOF_SCOPES,
} from "@/lib/auth/oidc/proof-scopes";
import { eip712Auth } from "@/lib/auth/plugins/eip712/server";
import { opaque } from "@/lib/auth/plugins/opaque/server";
import { db } from "@/lib/db/connection";
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
  if (path.includes("/eip712/")) {
    return "eip712";
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
  "proof:identity",
  ...PROOF_SCOPES,
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
  new Set([
    ...oidcStandardClaims,
    ...PROOF_DISCLOSURE_KEYS,
    ...identityClaimKeys,
  ])
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
      disclosures: [...PROOF_DISCLOSURE_KEYS],
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
            disclosures: [...PROOF_DISCLOSURE_KEYS],
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

const DCR_CLIENT_NAME_MAX = 100;
const HTML_TAG_RE = /<[^>]+>/;
const isDev =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (isDev && url.hostname === "localhost") {
      return true;
    }
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateDcrRegistration(
  body: Record<string, unknown> | undefined
): void {
  if (!body) {
    return;
  }

  const clientName =
    typeof body.client_name === "string" ? body.client_name : undefined;
  if (clientName) {
    if (clientName.length > DCR_CLIENT_NAME_MAX) {
      throw new APIError("BAD_REQUEST", {
        error_description: `client_name exceeds ${DCR_CLIENT_NAME_MAX} characters`,
      });
    }
    if (HTML_TAG_RE.test(clientName)) {
      throw new APIError("BAD_REQUEST", {
        error_description: "client_name must not contain HTML",
      });
    }
  }

  const logoUri =
    typeof body.logo_uri === "string" ? body.logo_uri.trim() : undefined;
  if (logoUri && !isValidHttpsUrl(logoUri)) {
    throw new APIError("BAD_REQUEST", {
      error_description: "logo_uri must be an HTTPS URL",
    });
  }

  const clientUri =
    typeof body.client_uri === "string" ? body.client_uri.trim() : undefined;
  if (clientUri && !isValidHttpsUrl(clientUri)) {
    throw new APIError("BAD_REQUEST", {
      error_description: "client_uri must be an HTTPS URL",
    });
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris
    : undefined;
  if (redirectUris) {
    for (const uri of redirectUris) {
      if (typeof uri !== "string") {
        continue;
      }
      try {
        const parsed = new URL(uri);
        const isLocalhost = parsed.hostname === "localhost";
        if (!isDev && isLocalhost) {
          throw new APIError("BAD_REQUEST", {
            error_description:
              "redirect_uris must use HTTPS in production (localhost not allowed)",
          });
        }
        if (!isLocalhost && parsed.protocol !== "https:") {
          throw new APIError("BAD_REQUEST", {
            error_description: `redirect_uri must use HTTPS: ${uri}`,
          });
        }
      } catch (e) {
        if (e instanceof APIError) {
          throw e;
        }
        throw new APIError("BAD_REQUEST", {
          error_description: `Invalid redirect_uri: ${uri}`,
        });
      }
    }
  }
}

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
          "/eip712/nonce": {
            window: 60,
            max: 10,
          },
          "/sign-up/eip712/register": {
            window: 60,
            max: 5,
          },
          "/sign-in/eip712/verify": {
            window: 60,
            max: 10,
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
    // biome-ignore lint/suspicious/useAwait: createAuthMiddleware requires async signature
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/oauth2/register") {
        return validateDcrRegistration(ctx.body);
      }

      // Server-side enforcement: strip identity.* scopes from consent to
      // ensure they are never persisted, regardless of client behavior.
      if (
        ctx.path === "/oauth2/consent" &&
        typeof ctx.body?.scope === "string"
      ) {
        const filtered = ctx.body.scope
          .split(" ")
          .filter((s: string) => !isIdentityScope(s))
          .join(" ");
        ctx.body.scope = filtered;
      }
    }),
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
    eip712Auth({
      appName: "Zentity",
      emailDomainName: process.env.EIP712_EMAIL_DOMAIN || "wallet.zentity.app",
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
        // Proof scopes — verification status flags (no PII, derived booleans only)
        "proof:identity", // Umbrella: all verification claims
        ...PROOF_SCOPES, // Granular: proof:verification, proof:age, proof:document, etc.
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
      customIdTokenClaims: ({ user }) => {
        const ephemeral = consumeEphemeralClaims(user.id);
        if (!ephemeral) {
          return {};
        }

        return filterIdentityByScopes(ephemeral.claims, ephemeral.scopes);
      },
      customUserInfoClaims: async ({ user, scopes }) => {
        const scopeList: string[] = Array.isArray(scopes) ? scopes : [];

        // Proof verification claims — filtered by granular proof:* sub-scopes
        const hasProofScopes =
          scopeList.includes("proof:identity") ||
          extractProofScopes(scopeList).length > 0;
        if (!hasProofScopes) {
          return {};
        }

        const allProofClaims = await buildProofClaims(user.id);
        return filterProofClaimsByScopes(allProofClaims, scopeList);
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
        buildProofClaims(user.id),
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
