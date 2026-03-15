import type { OpaqueEndpointContext } from "@/lib/auth/plugins/opaque/types";

import { ciba } from "@better-auth/ciba";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  createDpopAccessTokenValidator,
  createDpopTokenBinding,
  createJarmHandler,
  createKeyAttestationValidator,
  createParResolver,
  createWalletAttestationStrategy,
  createX5cHeaders,
  haip,
  WALLET_ATTESTATION_TYPE,
} from "@better-auth/haip";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oidc4ida } from "@better-auth/oidc4ida";
import { type Oidc4vciOptions, oidc4vci } from "@better-auth/oidc4vci";
import { oidc4vp } from "@better-auth/oidc4vp";
import { passkey } from "@better-auth/passkey";
import { APIError, betterAuth } from "better-auth";
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
import { and, desc, eq } from "drizzle-orm";

import { env } from "@/env";
import { getAssuranceForOAuth } from "@/lib/assurance/data";
import {
  computeAcr,
  computeAcrEidas,
  computeAtHash,
  loginMethodToAmr,
} from "@/lib/assurance/oidc-claims";
import { getDpopNonceStore } from "@/lib/auth/dpop-nonce-store";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import { resolveCimdClient } from "@/lib/auth/oidc/cimd";
import { isUrlClientId } from "@/lib/auth/oidc/cimd-validation";
import {
  buildOidcVerifiedClaims,
  buildProofClaims,
  PROOF_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/claims";
import { consumeEphemeralClaimsByUser } from "@/lib/auth/oidc/ephemeral-identity-claims";
import { consumeReleaseHandle } from "@/lib/auth/oidc/ephemeral-release-handles";
import {
  filterIdentityByScopes,
  IDENTITY_SCOPE_CLAIMS,
  IDENTITY_SCOPES,
  isIdentityScope,
} from "@/lib/auth/oidc/identity-scopes";
import { getJarmDecryptionKey } from "@/lib/auth/oidc/jarm-key";
import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import { OAUTH_SCOPES } from "@/lib/auth/oidc/oauth-scopes";
import {
  extractProofScopes,
  filterProofClaimsByScopes,
  PROOF_SCOPES,
} from "@/lib/auth/oidc/proof-scopes";
import { validateResourceUri } from "@/lib/auth/oidc/resource";
import {
  enforceCibaApprovalAcr,
  enforceCibaTokenAcr,
} from "@/lib/auth/oidc/step-up-ciba";
import { enforceStepUp } from "@/lib/auth/oidc/step-up-hook";
import {
  TOKEN_EXCHANGE_GRANT_TYPE,
  tokenExchangePlugin,
} from "@/lib/auth/oidc/token-exchange";
import { createTrustedDcqlMatcher } from "@/lib/auth/oidc/trusted-dcql-matcher";
import { loadX5cChain } from "@/lib/auth/oidc/x5c-loader";
import { validateX509Hash } from "@/lib/auth/oidc/x509-validation";
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
import { cibaRequests } from "@/lib/db/schema/ciba";
import { haipPushedRequests, haipVpSessions } from "@/lib/db/schema/haip";
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
import { sendCibaNotification } from "@/lib/email/ciba-mailer";
import { buildCibaPushPayload } from "@/lib/push/ciba-payload";
import { sendWebPush } from "@/lib/push/web-push";
import { RECOVERY_GUARDIAN_TYPE_TWO_FACTOR } from "@/lib/recovery/constants";

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
  haipPushedRequest: haipPushedRequests,
  haipVpSession: haipVpSessions,
  cibaRequest: cibaRequests,
};

function toScopeList(scopes: unknown): string[] {
  return Array.isArray(scopes) ? [...scopes] : [];
}

function hasAnyProofScope(scopeList: string[]): boolean {
  return (
    scopeList.includes("proof:identity") ||
    extractProofScopes(scopeList).length > 0
  );
}

// Build trusted origins based on environment
// In production: only the configured app URL + any explicit TRUSTED_ORIGINS
// In development: also trust all localhost variants (IPv4/IPv6)
const getAppOrigin = (): string => {
  const base = env.NEXT_PUBLIC_APP_URL;
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
  const additionalOrigins = env.TRUSTED_ORIGINS;
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
  const raw = env.GENERIC_OAUTH_PROVIDERS;
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
  if (path.includes("/passkey/")) {
    return "passkey";
  }
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
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
const isProduction = env.NODE_ENV === "production";
const oidc4vciCredentialAudience = `${authIssuer}/oidc4vci/credential`;
const rpApiAudience = `${authIssuer}/resource/rp-api`;
const identityClaimKeys = Array.from(
  new Set(Object.values(IDENTITY_SCOPE_CLAIMS).flat())
);
const defaultClientScopes = [
  "openid",
  "proof:identity",
  ...PROOF_SCOPES,
  ...IDENTITY_SCOPES,
];
const allowedClientScopes = [...defaultClientScopes, "email"];
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
const isOidcE2e = env.E2E_OIDC_ONLY === true;
// scope field added for HAIP §4.1; the oidc4vci plugin type doesn't include it yet,
// but it passes through to credential issuer metadata where the route handler picks it up
const oidc4vciCredentialConfigurations: Oidc4vciOptions["credentialConfigurations"] =
  [
    {
      id: "identity_verification",
      vct: "urn:credential:identity-verification:v1",
      format: "dc+sd-jwt",
      sdJwt: {
        disclosures: [...PROOF_DISCLOSURE_KEYS],
        decoyCount: 3,
      },
    },
    ...(isOidcE2e
      ? [
          {
            id: "identity_verification_deferred",
            vct: "urn:credential:identity-verification:v1:deferred",
            format: "dc+sd-jwt" as const,
            sdJwt: {
              disclosures: [...PROOF_DISCLOSURE_KEYS],
              decoyCount: 3,
            },
          },
        ]
      : []),
  ];

const oidc4vciDeferredIssuance = isOidcE2e
  ? {
      shouldDefer: async ({
        credentialConfigurationId,
      }: {
        credentialConfigurationId: string;
      }) => credentialConfigurationId === "identity_verification_deferred",
      intervalSeconds: 5,
      transactionExpiresInSeconds: 600,
    }
  : undefined;

const DCR_CLIENT_NAME_MAX = 100;
const HTML_TAG_RE = /<[^>]+>/;
const isDev =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const x5cChain = loadX5cChain();

// DPoP nonce store for server-managed nonce validation (RFC 9449 §4.1)
const nonceStore = getDpopNonceStore(env.DPOP_NONCE_TTL_SECONDS);

function extractDpopNonce(proofJwt: string): string | undefined {
  const [, b64] = proofJwt.split(".");
  const { nonce } = JSON.parse(
    Buffer.from(b64, "base64url").toString("utf8")
  ) as { nonce?: string };
  return typeof nonce === "string" ? nonce : undefined;
}

// Wrap DPoP token binding with server-managed nonce validation
const baseDpopBinding = createDpopTokenBinding({ requireDpop: true });
const dpopTokenBinding: typeof baseDpopBinding = async (input) => {
  const result = await baseDpopBinding(input);
  if (!result) {
    return null;
  }

  const proof = input.headers.get("DPoP");
  if (proof) {
    const nonce = extractDpopNonce(proof);
    if (nonce && !nonceStore.validate(nonce)) {
      throw new APIError("BAD_REQUEST", {
        message: "use_dpop_nonce: Invalid or expired DPoP nonce",
      });
    }
  }

  result.responseHeaders["DPoP-Nonce"] = nonceStore.issue();
  return result;
};

// Wrap DPoP access token validator with nonce enforcement
const baseDpopValidator = createDpopAccessTokenValidator({ requireDpop: true });
const dpopAccessTokenValidator: typeof baseDpopValidator = async (input) => {
  await baseDpopValidator(input);

  const proof = input.request.headers.get("DPoP");
  if (proof) {
    const nonce = extractDpopNonce(proof);
    if (nonce && !nonceStore.validate(nonce)) {
      throw new APIError("BAD_REQUEST", {
        message: "use_dpop_nonce: Invalid or expired DPoP nonce",
      });
    }
  }
};

// Wallet attestation with trusted issuers enforcement (HAIP §4.4.1.6)
const baseWalletStrategy = createWalletAttestationStrategy();
const trustedWalletIssuers = env.TRUSTED_WALLET_ISSUERS
  ? env.TRUSTED_WALLET_ISSUERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;
const walletAttestationStrategy = trustedWalletIssuers
  ? async (...args: Parameters<typeof baseWalletStrategy>) => {
      const result = await baseWalletStrategy(...args);
      const issuer = (result as { metadata?: { attestation_issuer?: string } })
        .metadata?.attestation_issuer;
      if (issuer && !trustedWalletIssuers.includes(issuer)) {
        throw new APIError("FORBIDDEN", {
          error_description: "Untrusted wallet attestation issuer",
        });
      }
      return result;
    }
  : baseWalletStrategy;

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
        // RFC 8252 §7.3: loopback IPs (127.0.0.1, [::1]) are allowed with HTTP for native apps
        const isLoopback =
          parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
        if (!isDev && isLocalhost) {
          throw new APIError("BAD_REQUEST", {
            error_description:
              "redirect_uris must use HTTPS in production (localhost not allowed)",
          });
        }
        if (!(isLocalhost || isLoopback) && parsed.protocol !== "https:") {
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

// ── Before-hook handlers ──────────────────────────────────

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function beforeDcrRegister(ctx: HookCtx) {
  validateDcrRegistration(ctx.body);
  if (ctx.body && !ctx.body.subject_type) {
    ctx.body.subject_type = "pairwise";
  }
}

async function beforeVpResponse(ctx: HookCtx) {
  const state =
    typeof ctx.body?.state === "string" ? ctx.body.state : undefined;
  if (!state) {
    return;
  }
  const vpSession = await db
    .select({
      clientId: haipVpSessions.clientId,
      clientIdScheme: haipVpSessions.clientIdScheme,
    })
    .from(haipVpSessions)
    .where(eq(haipVpSessions.state, state))
    .limit(1)
    .get();

  if (vpSession?.clientIdScheme === "x509_hash" && vpSession.clientId) {
    const chain = loadX5cChain();
    if (!(chain && validateX509Hash(vpSession.clientId, chain))) {
      throw new APIError("FORBIDDEN", {
        message: "x509_hash client_id does not match certificate chain",
      });
    }
  }
}

async function beforeTokenPairwiseGuard(ctx: HookCtx) {
  if (!ctx.body?.resource) {
    return;
  }
  const clientId =
    typeof ctx.body.client_id === "string" ? ctx.body.client_id : undefined;
  if (!clientId) {
    return;
  }
  const client = await db
    .select({ subjectType: oauthClients.subjectType })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
  if (client?.subjectType === "pairwise") {
    ctx.body.resource = undefined;
  }
}

function beforeConsentStripIdentityScopes(ctx: HookCtx) {
  if (typeof ctx.body?.scope !== "string") {
    return;
  }
  ctx.body.scope = ctx.body.scope
    .split(" ")
    .filter((s: string) => !isIdentityScope(s))
    .join(" ");
}

function beforeValidateResourceUri(ctx: HookCtx) {
  const result = validateResourceUri(ctx.body?.resource);
  if (!result.valid) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: result.error,
    });
  }
}

async function beforeResolveCimd(ctx: HookCtx) {
  const clientId =
    ctx.path === "/oauth2/par"
      ? (ctx.body?.client_id as string | undefined)
      : (ctx.query?.client_id as string | undefined);
  if (clientId && isUrlClientId(clientId, isProduction)) {
    const cimd = await resolveCimdClient(clientId);
    if (!cimd.resolved) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_client",
        error_description: cimd.error,
      });
    }
  }
}

function beforeTokenValidateResource(ctx: HookCtx) {
  const grantType = ctx.body?.grant_type as string | undefined;
  if (grantType === "client_credentials") {
    beforeValidateResourceUri(ctx);
  } else if (grantType === "authorization_code" && ctx.body?.resource) {
    beforeValidateResourceUri(ctx);
  }
}

// ── After-hook handlers ───────────────────────────────────

async function afterConsentPairwiseCleanup(ctx: HookCtx) {
  const sessionCtx = ctx.context as {
    session?: { user?: { id?: string } };
  };
  const userId = sessionCtx.session?.user?.id;
  const oauthQuery =
    typeof ctx.body?.oauth_query === "string"
      ? ctx.body.oauth_query
      : undefined;
  if (!(userId && oauthQuery)) {
    return;
  }
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id");
  const originalScopes = (params.get("scope") ?? "").split(" ");
  const hasIdentityScopes = originalScopes.some((s) => isIdentityScope(s));

  if (clientId && !hasIdentityScopes) {
    const client = await db
      .select({ subjectType: oauthClients.subjectType })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)
      .get();

    if (client?.subjectType === "pairwise") {
      await db
        .delete(oauthConsents)
        .where(
          and(
            eq(oauthConsents.userId, userId),
            eq(oauthConsents.clientId, clientId)
          )
        )
        .run();
    }
  }
}

async function afterParPersistResource(ctx: HookCtx) {
  if (!ctx.body?.resource) {
    return;
  }
  const clientId = ctx.body.client_id as string | undefined;
  if (!clientId) {
    return;
  }
  const record = await db
    .select({ id: haipPushedRequests.id })
    .from(haipPushedRequests)
    .where(eq(haipPushedRequests.clientId, clientId))
    .orderBy(desc(haipPushedRequests.createdAt))
    .limit(1)
    .get();
  if (record) {
    await db
      .update(haipPushedRequests)
      .set({ resource: ctx.body.resource as string })
      .where(eq(haipPushedRequests.id, record.id))
      .run();
  }
}

async function afterTwoFactorDisableGuardianCleanup(ctx: HookCtx) {
  const sessionCtx = ctx.context as {
    session?: { user?: { id?: string } };
  };
  const userId = sessionCtx.session?.user?.id;
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
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: betterAuthSchema,
  }),
  secret: env.BETTER_AUTH_SECRET,
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
        "/recovery/password/reset",
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
  account: {
    encryptOAuthTokens: true,
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => ({
          data: { ...session, ipAddress: null, userAgent: null },
        }),
      },
    },
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      disableSignUp: true,
      disableDefaultScope: true,
      scope: ["openid", "email"],
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      disableSignUp: true,
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
      if (ctx.path === "/oauth2/register") {
        return beforeDcrRegister(ctx);
      }
      if (ctx.path === "/oidc4vp/response") {
        return beforeVpResponse(ctx);
      }
      if (ctx.path === "/oauth2/token") {
        await beforeTokenPairwiseGuard(ctx);
        if (ctx.body?.grant_type === "urn:openid:params:grant-type:ciba") {
          await enforceCibaTokenAcr(ctx, db);
        }
        beforeTokenValidateResource(ctx);
        return;
      }
      if (ctx.path === "/oauth2/consent") {
        return beforeConsentStripIdentityScopes(ctx);
      }
      if (ctx.path === "/oauth2/par") {
        beforeValidateResourceUri(ctx);
        await beforeResolveCimd(ctx);
        return;
      }
      if (ctx.path === "/oauth2/authorize") {
        await beforeResolveCimd(ctx);
        await enforceStepUp(ctx, db);
        return;
      }
      if (ctx.path === "/ciba/authorize") {
        return enforceCibaApprovalAcr(ctx, db);
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/oauth2/consent") {
        await afterConsentPairwiseCleanup(ctx);
        return;
      }
      if (ctx.path === "/oauth2/par") {
        await afterParPersistResource(ctx);
        return;
      }
      if (ctx.path === "/two-factor/disable") {
        await afterTwoFactorDisableGuardianCleanup(ctx);
      }
    }),
  },
  plugins: [
    nextCookies(),
    opaque({
      serverSetup: () => env.OPAQUE_SERVER_SETUP,
      resolveUserByIdentifier: resolveOpaqueUserByIdentifier,
      sendResetPassword: async ({ user: _user, url: _url }) => {
        // TODO: Implement email sending when SMTP is configured
        // For now, silently succeed - the user won't receive an email but can retry
      },
      revokeSessionsOnPasswordReset: true,
    }),
    anonymous({
      emailDomainName: "anon.zentity.app",
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
      emailDomainName: "wallet.zentity.app",
    }),
    genericOAuth({
      config: parseGenericOAuthConfig(),
    }),
    lastLoginMethod({
      customResolveMethod: resolveLastLoginMethod,
      storeInDatabase: true,
    }),
    jwt({
      jwks: {
        disablePrivateKeyEncryption: true,
        keyPairConfig: { alg: "EdDSA" },
        remoteUrl: joinAuthIssuerPath(authIssuer, "oauth2/jwks"),
      },
      jwt: {
        issuer: authIssuer,
        sign: signJwt,
      },
    }),
    oauthProvider({
      tokenBinding: dpopTokenBinding,
      requestUriResolver: createParResolver(),
      clientAuthStrategies: {
        [WALLET_ATTESTATION_TYPE]: walletAttestationStrategy as never,
      },
      pairwiseSecret: env.PAIRWISE_SECRET,
      scopes: [...OAUTH_SCOPES],
      grantTypes: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "urn:openid:params:grant-type:ciba",
        TOKEN_EXCHANGE_GRANT_TYPE as typeof TOKEN_EXCHANGE_GRANT_TYPE &
          "authorization_code",
      ],
      validAudiences: [
        appUrl,
        authIssuer,
        oidc4vciCredentialAudience,
        rpApiAudience,
      ],
      // Enable RFC 7591 Dynamic Client Registration for OIDC4VCI wallets
      // Wallets can self-register via POST /api/auth/oauth/register
      allowDynamicClientRegistration: true,
      // Allow public clients (no client_secret) - required for mobile/browser wallets
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: defaultClientScopes,
      clientRegistrationAllowedScopes: allowedClientScopes,
      clientReference: ({ session }) =>
        typeof session?.activeOrganizationId === "string"
          ? session.activeOrganizationId
          : undefined,
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      advertisedMetadata: {
        claims_supported: advertisedClaims,
      },
      customAccessTokenClaims: ({ user, scopes, referenceId }) => {
        if (!user?.id) {
          return {};
        }
        const scopeList = toScopeList(scopes);
        if (!scopeList.some(isIdentityScope)) {
          return {};
        }
        const handle = consumeReleaseHandle(user.id, referenceId ?? undefined);
        return handle ? { release_handle: handle } : {};
      },
      customIdTokenClaims: async ({ user, scopes, metadata, accessToken }) => {
        const scopeList = toScopeList(scopes);

        // Identity claims require ephemeral staging (vault unlock)
        const ephemeral = consumeEphemeralClaimsByUser(user.id);
        const identityClaims = ephemeral
          ? filterIdentityByScopes(ephemeral.claims, ephemeral.scopes)
          : {};

        // Proof claims use the granted scopes directly — no vault unlock needed
        const proofClaims = hasAnyProofScope(scopeList)
          ? filterProofClaimsByScopes(
              await buildProofClaims(user.id),
              scopeList
            )
          : {};

        // Assurance claims: acr, acr_eidas, amr (emitted when openid scope present)
        let assuranceClaims: Record<string, unknown> = {};
        if (scopeList.includes("openid") && user?.id) {
          const assurance = await getAssuranceForOAuth(user.id);
          assuranceClaims = {
            acr: computeAcr(assurance.tier),
            acr_eidas: computeAcrEidas(assurance.tier),
            amr: loginMethodToAmr(assurance.loginMethod),
            auth_time: assurance.authTime,
          };
        }

        // at_hash (OIDC Core §3.1.3.6) — hash alg matches id_token signing alg
        let atHashClaim: Record<string, unknown> = {};
        if (accessToken) {
          const signingAlg =
            (metadata?.id_token_signed_response_alg as string) || "RS256";
          const atHash = computeAtHash(accessToken, signingAlg);
          if (atHash) {
            atHashClaim = { at_hash: atHash };
          }
        }

        return {
          ...identityClaims,
          ...proofClaims,
          ...assuranceClaims,
          ...atHashClaim,
        };
      },
      customUserInfoClaims: async ({ user, scopes }) => {
        const scopeList = toScopeList(scopes);

        if (!hasAnyProofScope(scopeList)) {
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
      defaultWalletClientId: "zentity-wallet",
      credentialIssuer: authIssuer,
      issuerBaseURL: authIssuer,
      credentialAudience: oidc4vciCredentialAudience,
      authorizationServer: authIssuer,
      credentialConfigurations: oidc4vciCredentialConfigurations,
      accessTokenValidator: dpopAccessTokenValidator,
      proofValidators: {
        attestation: createKeyAttestationValidator(),
      },
      ...(x5cChain
        ? { resolveCredentialHeaders: createX5cHeaders(x5cChain) }
        : {}),
      resolveClaims: async ({ user }: { user: { id: string } }) =>
        buildProofClaims(user.id),
      ...(oidc4vciDeferredIssuance
        ? { deferredIssuance: oidc4vciDeferredIssuance }
        : {}),
    }),
    oidc4vp({
      expectedAudience: authIssuer,
      allowedIssuers: [authIssuer],
      presentationMatcher: createTrustedDcqlMatcher(),
      responseModeHandlers: {
        "direct_post.jwt": createJarmHandler({
          decryptionKey: getJarmDecryptionKey,
          supportedAlgs: ["ECDH-ES"],
          supportedEnc: ["A128GCM", "A256GCM"],
        }),
      },
      resolveIssuerJwks: async (issuer: string) => {
        const jwksUrl =
          env.OIDC4VP_JWKS_URL ?? joinAuthIssuerPath(issuer, "oauth2/jwks");
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
    haip({
      requirePar: true,
      requireDpop: true,
      dpopSigningAlgValues: ["ES256"],
      parExpiresInSeconds: 60,
      vpRequestExpiresInSeconds: 300,
    }),
    ciba({
      deliveryModes: ["poll", "ping"],
      requestLifetime: 300,
      pollingInterval: 5,
      async resolveUser(loginHint, ctx) {
        const byId = await ctx.context.internalAdapter.findUserById(loginHint);
        if (byId) {
          return byId;
        }
        const byEmail =
          await ctx.context.internalAdapter.findUserByEmail(loginHint);
        return byEmail?.user ?? null;
      },
      async resolveClientNotificationEndpoint(clientId) {
        const client = await db
          .select({ metadata: oauthClients.metadata })
          .from(oauthClients)
          .where(eq(oauthClients.clientId, clientId))
          .get();
        if (!client?.metadata) {
          return undefined;
        }
        const meta = JSON.parse(client.metadata) as Record<string, unknown>;
        return (
          (meta.backchannel_client_notification_endpoint as string) ?? undefined
        );
      },
      sendNotification: async (data) => {
        const origin = getAppOrigin();
        const pushPayload = buildCibaPushPayload(data, origin);
        await Promise.allSettled([
          sendWebPush(data.userId, pushPayload),
          sendCibaNotification({
            userId: data.userId,
            authReqId: data.authReqId,
            clientName: data.clientName,
            scope: data.scope,
            bindingMessage: data.bindingMessage,
            authorizationDetails: data.authorizationDetails,
            approvalUrl: pushPayload.data.approvalUrl,
          }),
        ]);
      },
    }),
    tokenExchangePlugin(),
  ],
});

export type Session = typeof auth.$Infer.Session;
