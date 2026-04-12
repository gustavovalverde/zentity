import type { LoginMethod } from "@/lib/assurance/types";
import type { OpaqueEndpointContext } from "@/lib/auth/opaque/types";

import { createHash } from "node:crypto";

import { ciba, deliverPing } from "@better-auth/ciba";
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
import { APIError, type BetterAuthPlugin, betterAuth } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import {
  admin,
  anonymous,
  genericOAuth,
  jwt,
  magicLink,
  twoFactor,
} from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "@/env";
import { getAccountAssurance } from "@/lib/assurance/data";
import { buildOidcAssuranceClaims } from "@/lib/assurance/oidc-claims";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createSessionAuthenticationContext,
  getAuthenticationStateBySessionId,
  resolveAuthenticationContext,
} from "@/lib/auth/authentication-context";
import { eip712Auth } from "@/lib/auth/eip712/server";
import { AGENT_BOOTSTRAP_SCOPES } from "@/lib/auth/oidc/agent-scopes";
import {
  revokePendingCibaOnLogout,
  sendBackchannelLogout,
} from "@/lib/auth/oidc/backchannel-logout";
import { resolveCimdClient } from "@/lib/auth/oidc/cimd";
import { isUrlClientId } from "@/lib/auth/oidc/cimd-validation";
import {
  buildOidcVerifiedClaims,
  buildProofClaims,
  PROOF_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/claims";
import { filterClaimsByRequest } from "@/lib/auth/oidc/claims-parameter";
import { computeConsentHmac } from "@/lib/auth/oidc/consent-integrity";
import {
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  claimsRequestForEndpoint,
  consumeReleaseIdentityPayload,
  DisclosureBindingError,
  finalizeOauthDisclosureFromVerification,
  hasReleaseContext,
  loadReleaseContext,
  type ReleaseContext,
  touchReleaseContext,
  validateReleaseContextForSubject,
} from "@/lib/auth/oidc/disclosure-context";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
  filterProofClaimsByScopes,
  hasAnyProofScope,
  IDENTITY_SCOPE_CLAIMS,
  IDENTITY_SCOPES,
  isIdentityScope,
  OAUTH_SCOPES,
  PROOF_SCOPES,
} from "@/lib/auth/oidc/disclosure-registry";
import { getDpopNonceStore } from "@/lib/auth/oidc/dpop-nonce-store";
import {
  finalReleaseIdentityKey,
  hasIdentityPayload,
} from "@/lib/auth/oidc/ephemeral-identity-claims";
import { persistOpaqueAccessTokenDpopBinding } from "@/lib/auth/oidc/haip/opaque-access-token";
import { getProtectedResourceAudiences } from "@/lib/auth/oidc/haip/protected-resources";
import { createTrustedDcqlMatcher } from "@/lib/auth/oidc/haip/trusted-dcql-matcher";
import {
  loadX5cChain,
  validateX509Chain,
} from "@/lib/auth/oidc/haip/x509-validation";
import { getJarmDecryptionKey } from "@/lib/auth/oidc/jwt/jarm-key";
import { signJwt } from "@/lib/auth/oidc/jwt/jwt-signer";
import { getJwtSigningKeys } from "@/lib/auth/oidc/jwt/jwt-signing-keys";
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
import { opaque } from "@/lib/auth/opaque/server";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/well-known";
import {
  loadAapProfileForCibaRequest,
  persistAapSnapshotForCibaToken,
} from "@/lib/ciba/aap-profile";
import { bindAgentAssertionToCibaRequest } from "@/lib/ciba/agent-binding";
import {
  deriveCapabilityName,
  evaluateSessionGrants,
  normalizeAuthorizationDetails,
} from "@/lib/ciba/grant-evaluation";
import { buildCibaPushPayload } from "@/lib/ciba/push-payload";
import { sendWebPush } from "@/lib/ciba/push-sender";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { getLatestVerification } from "@/lib/db/queries/identity";
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
import { RECOVERY_GUARDIAN_TYPE_TWO_FACTOR } from "@/lib/db/schema/recovery";
import { sendCibaNotification } from "@/lib/email/ciba-mailer";
import { computeRpNullifier } from "@/lib/identity/dedup";
import { logger as rootLogger } from "@/lib/logging/logger";
import { getConsentHmacKey } from "@/lib/privacy/primitives/derived-keys";
import { validateSafeUrl } from "@/lib/utils/url-safety";

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

function invalidGrantDisclosureError(reason: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: reason,
  });
}

function invalidTokenDisclosureError(reason: string): APIError {
  return new APIError("UNAUTHORIZED", {
    error: "invalid_token",
    error_description: reason,
  });
}

function toDisclosureApiError(error: DisclosureBindingError): APIError {
  return error.oauthError === "invalid_grant"
    ? invalidGrantDisclosureError(error.reason)
    : invalidTokenDisclosureError(error.reason);
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

const resolveLastLoginMethod = (ctx: { path?: string }): LoginMethod | null => {
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
  if (path.startsWith("/sign-up/opaque/complete")) {
    return "opaque";
  }
  if (
    path.startsWith("/sign-in/social") ||
    path.startsWith("/sign-in/oauth2") ||
    path.startsWith("/callback/") ||
    path.startsWith("/oauth2/callback/")
  ) {
    return "oauth";
  }
  if (path.includes("/eip712/")) {
    return "eip712";
  }
  if (path.startsWith("/sign-in/email") || path.startsWith("/sign-up/email")) {
    return "credential";
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

const identityReleaseLog = rootLogger.child({
  component: "identity-release",
});

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
  "proof:sybil",
  ...PROOF_SCOPES,
  ...IDENTITY_SCOPES,
];
const allowedClientScopes = [
  ...defaultClientScopes,
  "email",
  "poh",
  "offline_access",
  ...AGENT_BOOTSTRAP_SCOPES,
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
const isOidcE2e = env.E2E_OIDC_ONLY === true;
const isPlaywrightE2e =
  typeof process.env.E2E_DATABASE_PATH === "string" ||
  typeof process.env.E2E_TURSO_DATABASE_URL === "string";
const enableEmailAndPassword = isOidcE2e || isPlaywrightE2e;
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
  const b64 = proofJwt.split(".")[1];
  if (!b64) {
    return undefined;
  }
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

async function validateDcrRegistration(
  body: Record<string, unknown> | undefined
): Promise<void> {
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
    let pairwiseHost: string | null = null;
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
        if (!pairwiseHost) {
          pairwiseHost = parsed.host;
        } else if (pairwiseHost !== parsed.host) {
          throw new APIError("BAD_REQUEST", {
            error_description:
              "redirect_uris must share the same host until sector_identifier_uri is supported",
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

  // OIDC BCL: validate backchannel_logout_uri if present
  const bclUri =
    typeof body.backchannel_logout_uri === "string"
      ? body.backchannel_logout_uri.trim()
      : undefined;
  if (bclUri && !isDev && !isValidHttpsUrl(bclUri)) {
    throw new APIError("BAD_REQUEST", {
      error_description: "backchannel_logout_uri must be an HTTPS URL",
    });
  }

  // RFC 7591 §2.3: software_statement — verify JWT signature against publisher's JWKS
  const softwareStatement =
    typeof body.software_statement === "string"
      ? body.software_statement
      : undefined;
  if (softwareStatement) {
    const parts = softwareStatement.split(".");
    if (parts.length !== 3) {
      throw new APIError("BAD_REQUEST", {
        error_description: "software_statement must be a valid JWT",
      });
    }

    let claims: Record<string, unknown>;
    try {
      const payload = parts[1];
      if (!payload) {
        throw new Error("missing payload");
      }
      claims = JSON.parse(
        Buffer.from(payload, "base64url").toString()
      ) as Record<string, unknown>;
    } catch {
      throw new APIError("BAD_REQUEST", {
        error_description: "software_statement payload is not valid JSON",
      });
    }

    const iss = typeof claims.iss === "string" ? claims.iss : undefined;
    if (!iss) {
      throw new APIError("BAD_REQUEST", {
        error_description:
          "software_statement must contain an iss claim for signature verification",
      });
    }

    // Issuer allowlist: fail-closed in production, SSRF-only check in dev
    const trustedIssuers = env.TRUSTED_SOFTWARE_STATEMENT_ISSUERS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (trustedIssuers && trustedIssuers.length > 0) {
      if (!trustedIssuers.includes(iss)) {
        throw new APIError("BAD_REQUEST", {
          error_description: `software_statement issuer is not trusted: ${iss}`,
        });
      }
    } else if (isDev) {
      // No allowlist in dev — SSRF check still applies below
    } else {
      throw new APIError("BAD_REQUEST", {
        error_description:
          "TRUSTED_SOFTWARE_STATEMENT_ISSUERS must be configured in production",
      });
    }

    // SSRF protection: block private IPs, enforce HTTPS in prod
    const ssrfError = validateSafeUrl(iss, !isDev);
    if (ssrfError) {
      throw new APIError("BAD_REQUEST", {
        error_description: `software_statement issuer URL rejected: ${ssrfError}`,
      });
    }

    try {
      const jwksUrl = new URL(joinAuthIssuerPath(iss, ".well-known/jwks.json"));
      const jwks = createRemoteJWKSet(jwksUrl);
      await jwtVerify(softwareStatement, jwks, { issuer: iss });
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : "signature verification failed";
      throw new APIError("BAD_REQUEST", {
        error_description: `software_statement verification failed: ${detail}`,
      });
    }
  }
}

// ── Before-hook handlers ──────────────────────────────────

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";

async function beforeDcrRegister(ctx: HookCtx) {
  await validateDcrRegistration(ctx.body);
  if (ctx.body && !ctx.body.subject_type) {
    ctx.body.subject_type = "pairwise";
  }
  // Enable the plugin's native sid injection for BCL-registered clients
  if (ctx.body?.backchannel_logout_uri) {
    ctx.body.enable_end_session = true;
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
    if (!chain) {
      throw new APIError("FORBIDDEN", {
        message: "x5c certificate chain not available",
      });
    }
    const result = validateX509Chain(vpSession.clientId, chain);
    if (!result.valid) {
      throw new APIError("FORBIDDEN", {
        message: result.error ?? "x509 chain validation failed",
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

function hashAuthorizationCodeIdentifier(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

async function beforeTokenFinalizeDisclosureBindings(ctx: HookCtx) {
  const code = typeof ctx.body?.code === "string" ? ctx.body.code : undefined;
  if (!code) {
    return;
  }

  let record = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, code))
    .limit(1)
    .get();
  if (!record?.value) {
    const hashedCode = hashAuthorizationCodeIdentifier(code);
    if (hashedCode !== code) {
      record = await db
        .select({ value: verifications.value })
        .from(verifications)
        .where(eq(verifications.identifier, hashedCode))
        .limit(1)
        .get();
    }
  }
  if (!record?.value) {
    return;
  }

  let stored: {
    referenceId?: string;
    type?: string;
    query?: Record<string, unknown>;
    userId?: string;
  };
  try {
    stored = JSON.parse(record.value) as typeof stored;
  } catch {
    // Malformed verification value — skip disclosure finalization
    return;
  }
  if (stored.type !== "authorization_code" || !stored.userId) {
    return;
  }

  try {
    await finalizeOauthDisclosureFromVerification({
      query: stored.query ?? {},
      userId: stored.userId,
      ...(stored.referenceId ? { referenceId: stored.referenceId } : {}),
    });
  } catch (error) {
    if (error instanceof DisclosureBindingError) {
      identityReleaseLog.error(
        {
          event: "token_exchange_disclosure_failure",
          reason: error.reason,
          oauthError: error.oauthError,
          userId: stored.userId,
          clientId: stored.query?.client_id,
          hasReferenceId: Boolean(stored.referenceId),
          scopes: stored.query?.scope,
        },
        "Disclosure binding failed during token exchange"
      );
      throw toDisclosureApiError(error);
    }
    identityReleaseLog.error(
      {
        event: "token_exchange_unexpected_error",
        userId: stored.userId,
        clientId: stored.query?.client_id,
        error: error instanceof Error ? error.message : String(error),
      },
      "Unexpected error during disclosure finalization"
    );
    throw error;
  }
}

function refreshStaleCimdMetadata(ctx: HookCtx) {
  const clientId =
    typeof ctx.body?.client_id === "string" ? ctx.body.client_id : undefined;
  if (!(clientId && isUrlClientId(clientId, isProduction))) {
    return;
  }

  // Fire-and-forget: refresh CIMD metadata if stale
  resolveCimdClient(clientId).catch(() => {
    // CIMD refresh failure is non-fatal — cached metadata is retained
  });
}

async function buildIdTokenDisclosureClaims(input: {
  authContextId?: string | null;
  referenceId?: string;
  scopes: unknown;
  sessionId?: string | null;
  user: { id: string };
}): Promise<Record<string, unknown>> {
  const scopeList = toScopeList(input.scopes);
  const cibaAuth = input.referenceId
    ? await db
        .select({ authContextId: cibaRequests.authContextId })
        .from(cibaRequests)
        .where(eq(cibaRequests.authReqId, input.referenceId))
        .limit(1)
        .get()
    : null;
  const auth = await resolveAuthenticationContext({
    authContextId: input.authContextId ?? cibaAuth?.authContextId ?? null,
    sessionId: input.sessionId ?? null,
    userId: input.user.id,
  });

  const proofClaims = hasAnyProofScope(scopeList)
    ? filterProofClaimsByScopes(
        await buildProofClaims(input.user.id),
        scopeList,
        "id_token"
      )
    : {};

  let assuranceClaims: Record<string, unknown> = {};
  if (scopeList.includes("openid")) {
    // For refresh-token grants the original CIBA request may have been
    // deleted. Fall back to the refresh token's stored authContextId.
    let resolvedAuth = auth;
    if (!resolvedAuth && input.referenceId) {
      const refreshRow = await db
        .select({ authContextId: oauthRefreshTokens.authContextId })
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.referenceId, input.referenceId))
        .limit(1)
        .get();
      if (refreshRow?.authContextId) {
        resolvedAuth = await resolveAuthenticationContext({
          authContextId: refreshRow.authContextId,
          sessionId: null,
        });
      }
    }
    if (!resolvedAuth) {
      throw invalidGrantDisclosureError(
        "Authentication context required for ID token issuance"
      );
    }
    const assurance = await getAccountAssurance(input.user.id, {
      isAuthenticated: true,
    });
    assuranceClaims = {
      ...buildOidcAssuranceClaims(assurance, resolvedAuth),
    };
  }

  const authContextClaims = auth
    ? { [AUTHENTICATION_CONTEXT_CLAIM]: auth.id }
    : {};
  const releaseContext = input.referenceId
    ? await loadReleaseContext(input.referenceId)
    : null;
  const idTokenFilter = claimsRequestForEndpoint(
    releaseContext?.claimsRequest ?? null,
    "id_token"
  );

  return {
    ...filterClaimsByRequest(
      {
        ...proofClaims,
        ...assuranceClaims,
      },
      idTokenFilter
    ),
    ...authContextClaims,
  };
}

function exactDisclosureClaimsPlugin(): BetterAuthPlugin {
  return {
    id: "exact-disclosure-claims",
    extensions: {
      "oauth-provider": {
        tokenClaims: {
          id: async (info) =>
            buildIdTokenDisclosureClaims({
              ...((info as { authContextId?: string | null }).authContextId ===
              undefined
                ? {}
                : {
                    authContextId: (info as { authContextId?: string | null })
                      .authContextId,
                  }),
              ...(info.referenceId ? { referenceId: info.referenceId } : {}),
              scopes: info.scopes,
              ...((info as { sessionId?: string | null }).sessionId ===
              undefined
                ? {}
                : {
                    sessionId: (info as { sessionId?: string | null })
                      .sessionId,
                  }),
              user: info.user,
            }),
        },
      },
    },
  } as BetterAuthPlugin;
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

async function beforeAuthorizeVerifyConsentHmac(ctx: HookCtx) {
  const session = await getSessionFromCtx(ctx);
  const userId = session?.user?.id;
  const clientId = ctx.query?.client_id as string | undefined;
  if (!(userId && clientId)) {
    return;
  }

  const consent = await db
    .select({
      id: oauthConsents.id,
      scopes: oauthConsents.scopes,
      scopeHmac: oauthConsents.scopeHmac,
      referenceId: oauthConsents.referenceId,
    })
    .from(oauthConsents)
    .where(
      and(
        eq(oauthConsents.clientId, clientId),
        eq(oauthConsents.userId, userId)
      )
    )
    .limit(1)
    .get();

  if (!consent) {
    return;
  }

  const scopes = parseStoredStringArray(consent.scopes);

  const expected = computeConsentHmac(
    getConsentHmacKey(),
    userId,
    clientId,
    consent.referenceId,
    scopes
  );

  if (consent.scopeHmac !== expected) {
    await db
      .delete(oauthConsents)
      .where(eq(oauthConsents.id, consent.id))
      .run();
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

async function afterConsentStoreHmac(ctx: HookCtx) {
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
  if (!clientId) {
    return;
  }

  const consent = await db
    .select({
      id: oauthConsents.id,
      scopes: oauthConsents.scopes,
      referenceId: oauthConsents.referenceId,
    })
    .from(oauthConsents)
    .where(
      and(
        eq(oauthConsents.clientId, clientId),
        eq(oauthConsents.userId, userId)
      )
    )
    .limit(1)
    .get();

  if (!consent) {
    return;
  }

  const scopes = parseStoredStringArray(consent.scopes);

  const hmac = computeConsentHmac(
    getConsentHmacKey(),
    userId,
    clientId,
    consent.referenceId,
    scopes
  );

  await db
    .update(oauthConsents)
    .set({ scopeHmac: hmac })
    .where(eq(oauthConsents.id, consent.id))
    .run();
}

async function afterParPersistResource(ctx: HookCtx) {
  const resource =
    typeof ctx.body?.resource === "string" ? ctx.body.resource : undefined;
  const clientId =
    typeof ctx.body?.client_id === "string" ? ctx.body.client_id : undefined;
  if (!(resource && clientId)) {
    return;
  }
  const returned = (ctx as HookCtx & { returned?: unknown }).returned as
    | { request_uri?: unknown }
    | undefined;
  const requestUri = returned?.request_uri;
  if (typeof requestUri === "string" && requestUri.startsWith(PAR_URI_PREFIX)) {
    const requestId = requestUri.slice(PAR_URI_PREFIX.length);
    const result = await db
      .update(haipPushedRequests)
      .set({ resource })
      .where(eq(haipPushedRequests.requestId, requestId))
      .run();
    if (result.rowsAffected > 0) {
      return;
    }
  }

  // Better Auth's PAR endpoint persists the full request body in `requestParams`
  // but does not always expose the created `request_uri` through `ctx.returned`.
  // Fall back to the latest unresolved PAR row for this client with a matching
  // serialized request payload so the dedicated `resource` column stays in sync.
  const normalizedBody = JSON.stringify(
    Object.fromEntries(
      Object.entries(ctx.body as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string")
        .sort(([left], [right]) => left.localeCompare(right))
    )
  );
  const candidates = await db
    .select({
      id: haipPushedRequests.id,
      requestParams: haipPushedRequests.requestParams,
    })
    .from(haipPushedRequests)
    .where(
      and(
        eq(haipPushedRequests.clientId, clientId),
        isNull(haipPushedRequests.resource)
      )
    )
    .orderBy(desc(haipPushedRequests.createdAt))
    .limit(10)
    .all();
  const matchingRequest = candidates.find((candidate) => {
    try {
      const parsed = JSON.parse(candidate.requestParams) as Record<
        string,
        unknown
      >;
      const normalizedCandidate = JSON.stringify(
        Object.fromEntries(
          Object.entries(parsed)
            .filter(([, value]) => typeof value === "string")
            .sort(([left], [right]) => left.localeCompare(right))
        )
      );
      return normalizedCandidate === normalizedBody;
    } catch {
      return false;
    }
  });
  if (!matchingRequest) {
    return;
  }
  await db
    .update(haipPushedRequests)
    .set({ resource })
    .where(eq(haipPushedRequests.id, matchingRequest.id))
    .run();
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

// Stashed by CIBA buildAccessTokenClaims (while request still exists)
// for the after-hook to persist onto the opaque token record.
const pendingCibaAuthContext = new Map<string, string>();

async function afterTokenPersistOpaqueDpopBinding(ctx: HookCtx) {
  const returned = (ctx as HookCtx & { returned?: unknown }).returned as
    | { access_token?: unknown }
    | undefined;
  const accessToken = returned?.access_token;
  if (typeof accessToken !== "string") {
    return;
  }

  await persistOpaqueAccessTokenDpopBinding(accessToken, ctx.request);
}

function expireSessionDataCookie(ctx: HookCtx) {
  const authCookies = (
    ctx.context as {
      authCookies?: {
        sessionData?: {
          attributes?: Record<string, unknown>;
          name: string;
        };
      };
    }
  ).authCookies;
  const sessionDataCookie = authCookies?.sessionData;

  if (!sessionDataCookie) {
    return;
  }

  ctx.setCookie(sessionDataCookie.name, "", {
    ...sessionDataCookie.attributes,
    maxAge: 0,
  });
}

async function afterPersistAuthenticationContext(ctx: HookCtx) {
  if (ctx.path?.startsWith("/sign-in/anonymous")) {
    return;
  }

  const authMethod = resolveLastLoginMethod(ctx);
  const newSession = (
    ctx.context as {
      newSession?: {
        session?: { id?: string };
        user?: { id?: string };
      };
    }
  ).newSession;

  if (!(authMethod && newSession?.session?.id && newSession.user?.id)) {
    return;
  }

  await createSessionAuthenticationContext({
    userId: newSession.user.id,
    loginMethod: authMethod,
    sourceKind: "better_auth",
    sessionId: newSession.session.id,
  });

  // Better Auth may have already minted the encrypted session_data cookie
  // before authContextId is written to the session row. Expire it so the next
  // request reloads fresh session metadata from the database.
  expireSessionDataCookie(ctx);
}

async function afterCibaAuthorizePersistAuthContext(ctx: HookCtx) {
  const authReqId =
    typeof ctx.body?.auth_req_id === "string"
      ? ctx.body.auth_req_id
      : undefined;
  if (!authReqId) {
    return;
  }

  const sessionId = (ctx.context as { session?: { session?: { id?: string } } })
    .session?.session?.id;
  if (!sessionId) {
    return;
  }

  const auth = await getAuthenticationStateBySessionId(sessionId);
  if (!auth) {
    return;
  }

  await db
    .update(cibaRequests)
    .set({ authContextId: auth.id })
    .where(eq(cibaRequests.authReqId, authReqId))
    .run();
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: betterAuthSchema,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: authIssuer,
  trustedOrigins: getTrustedOrigins(),
  advanced: {
    // Allow service worker notification-click fetches (origin: null) for inline
    // approve/deny. Session cookie validation still runs via CIBA sessionMiddleware.
    disableOriginCheck: [
      "/ciba/authorize",
      "/ciba/reject",
    ] as unknown as boolean,
  },
  rateLimit:
    isOidcE2e || process.env.NODE_ENV === "test"
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
  disabledPaths: enableEmailAndPassword
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
  emailAndPassword: enableEmailAndPassword
    ? { enabled: true }
    : { enabled: false },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendEmailVerification } = await import("@/lib/email/auth-mailer");
      await sendEmailVerification({ user, url });
    },
  },
  user: {
    deleteUser: {
      enabled: true,
    },
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        const { sendChangeEmailConfirmation } = await import(
          "@/lib/email/auth-mailer"
        );
        await sendChangeEmailConfirmation({ user, newEmail, url });
      },
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
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            disableSignUp: true,
            disableDefaultScope: true,
            scope: ["openid", "email"],
          },
        }
      : {}),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            disableSignUp: true,
          },
        }
      : {}),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    storeSessionInDatabase: true,
    additionalFields: {
      authContextId: {
        type: "string",
        required: false,
        input: false,
        returned: true,
        fieldName: "authContextId",
      },
    },
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
        await beforeTokenFinalizeDisclosureBindings(ctx);
        refreshStaleCimdMetadata(ctx);
        return;
      }
      if (ctx.path === "/oauth2/consent") {
        return beforeConsentStripIdentityScopes(ctx);
      }
      if (ctx.path === "/oauth2/par") {
        if (!ctx.body?.resource) {
          throw new APIError("BAD_REQUEST", {
            error: "invalid_request",
            error_description:
              "resource parameter is required for PAR requests",
          });
        }
        beforeValidateResourceUri(ctx);
        await beforeResolveCimd(ctx);
        return;
      }
      if (ctx.path === "/oauth2/authorize") {
        if (!ctx.query?.resource) {
          ctx.query = { ...ctx.query, resource: appUrl };
        }
        await beforeResolveCimd(ctx);
        await enforceStepUp(ctx, db);
        await beforeAuthorizeVerifyConsentHmac(ctx);
        return;
      }
      if (ctx.path === "/ciba/authorize") {
        return enforceCibaApprovalAcr(ctx, db);
      }
      if (ctx.path === "/sign-out") {
        // Capture session before sign-out deletes it — needed for BCL
        const session = await getSessionFromCtx(ctx);
        if (session?.user?.id) {
          (ctx.context as Record<string, unknown>).__bclUserId =
            session.user.id;
          (ctx.context as Record<string, unknown>).__bclSessionId =
            session.session.id;
        }
        return;
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      await afterPersistAuthenticationContext(ctx);
      if (ctx.path === "/oauth2/consent") {
        await afterConsentPairwiseCleanup(ctx);
        await afterConsentStoreHmac(ctx);
        return;
      }
      if (ctx.path === "/oauth2/par") {
        await afterParPersistResource(ctx);
        return;
      }
      if (ctx.path === "/oauth2/token") {
        await afterTokenPersistOpaqueDpopBinding(ctx);
        // For CIBA tokens, persist authContextId on access + refresh token
        // records. The upstream createUserTokens stores only standard fields;
        // authContextId is a Zentity extension column.
        const authReqId = ctx.body?.auth_req_id as string | undefined;
        if (authReqId) {
          const authCtxId = pendingCibaAuthContext.get(authReqId);
          pendingCibaAuthContext.delete(authReqId);
          if (authCtxId) {
            await Promise.all([
              db
                .update(oauthAccessTokens)
                .set({ authContextId: authCtxId })
                .where(eq(oauthAccessTokens.referenceId, authReqId))
                .run(),
              db
                .update(oauthRefreshTokens)
                .set({ authContextId: authCtxId })
                .where(eq(oauthRefreshTokens.referenceId, authReqId))
                .run(),
            ]);
          }
        }
        return;
      }
      if (ctx.path === "/ciba/authorize") {
        await afterCibaAuthorizePersistAuthContext(ctx);
        return;
      }
      if (ctx.path === "/two-factor/disable") {
        await afterTwoFactorDisableGuardianCleanup(ctx);
      }
      if (ctx.path === "/sign-out") {
        const userId = (ctx.context as Record<string, unknown>).__bclUserId;
        const sessionId = (ctx.context as Record<string, unknown>)
          .__bclSessionId;
        if (typeof userId === "string") {
          // Fire-and-forget — don't block the logout response
          sendBackchannelLogout(
            userId,
            typeof sessionId === "string" ? sessionId : undefined
          );
          revokePendingCibaOnLogout(userId);
        }
      }
    }),
  },
  plugins: [
    nextCookies(),
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    opaque({
      serverSetup: () => env.OPAQUE_SERVER_SETUP,
      resolveUserByIdentifier: resolveOpaqueUserByIdentifier,
      sendResetPassword: async ({ user, url }) => {
        const { sendResetPasswordEmail } = await import(
          "@/lib/email/auth-mailer"
        );
        await sendResetPasswordEmail({ user, url });
      },
      revokeSessionsOnPasswordReset: true,
    }),
    anonymous({
      emailDomainName: "anon.zentity.app",
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { sendMagicLinkEmail } = await import("@/lib/email/auth-mailer");
        await sendMagicLinkEmail({ email, url });
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
    jwt({
      jwks: {
        // Keep framework defaults aligned with OIDC's RS256 id_token default.
        // Access tokens still use EdDSA via the custom signJwt dispatcher below.
        keyPairConfig: { alg: "RS256" },
        // Better Auth's OIDC4VCI signer reads JWKS rows directly from the
        // adapter. In this app those rows are stored as plain JWK JSON, so the
        // issuer must not attempt Better Auth envelope decryption here.
        disablePrivateKeyEncryption: true,
        remoteUrl: joinAuthIssuerPath(authIssuer, "oauth2/jwks"),
      },
      adapter: {
        getJwks: getJwtSigningKeys,
      },
      jwt: {
        issuer: authIssuer,
        sign: signJwt,
      },
    }),
    oauthProvider({
      silenceWarnings: { oauthAuthServerConfig: true },
      accessTokenExpiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
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
      validAudiences: getProtectedResourceAudiences({
        appUrl,
        authIssuer,
        mcpPublicUrl: env.MCP_PUBLIC_URL,
        oidc4vciCredentialAudience,
        rpApiAudience,
      }),
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
      postLogin: {
        page: "/oauth/consent",
        consentReferenceId: ({ user, session, scopes }) => {
          // Must be deterministic: the consent handler and the authorize
          // endpoint it re-invokes both call this callback and must get
          // the same value so the consent can be found on the second call.
          const sorted = [...scopes].sort().join(" ");
          return createHash("sha256")
            .update(`${user.id}:${session.id}:${sorted}`)
            .digest("base64url");
        },
        shouldRedirect: () => false,
      },
      advertisedMetadata: {
        claims_supported: advertisedClaims,
      },
      customAccessTokenClaims: async (info) => {
        const { user, scopes } = info;
        const authContextId = (info as { authContextId?: string })
          .authContextId;
        const clientId = (info as { clientId?: string }).clientId;
        const referenceId = (info as { referenceId?: string }).referenceId;
        const sessionId = (info as { sessionId?: string }).sessionId;
        if (!user?.id) {
          return {};
        }
        const scopeList = toScopeList(scopes);
        const claims: Record<string, unknown> = {};
        const cibaAuth = referenceId
          ? await db
              .select({ authContextId: cibaRequests.authContextId })
              .from(cibaRequests)
              .where(eq(cibaRequests.authReqId, referenceId))
              .limit(1)
              .get()
          : null;

        // Per-RP sybil nullifier
        if (scopeList.includes("proof:sybil") && clientId) {
          const verification = await getLatestVerification(user.id);
          if (verification?.dedupKey) {
            claims.sybil_nullifier = computeRpNullifier(
              env.DEDUP_HMAC_SECRET,
              verification.dedupKey,
              clientId
            );
          }
        }

        if (referenceId && clientId) {
          const aapSnapshot = await loadAapProfileForCibaRequest(
            referenceId,
            clientId
          );
          if (cibaAuth) {
            claims.jti = referenceId;
          }
          if (aapSnapshot) {
            Object.assign(
              claims,
              aapSnapshot.aap.agent?.id
                ? { act: { sub: aapSnapshot.aap.agent.id } }
                : {},
              aapSnapshot.aap
            );
          }
        }

        if (cibaAuth?.authContextId) {
          claims[AUTHENTICATION_CONTEXT_CLAIM] = cibaAuth.authContextId;
        }

        if (!sessionId && authContextId) {
          claims[AUTHENTICATION_CONTEXT_CLAIM] = authContextId;
        }

        if (referenceId && (await hasReleaseContext(referenceId))) {
          await touchReleaseContext(
            referenceId,
            Date.now() + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000
          );
          claims.zentity_release_id = referenceId;
        }

        return claims;
      },
      customUserInfoClaims: async (info) => {
        const { user, scopes } = info;
        const jwt = (
          info as {
            jwt?: {
              azp?: string;
              client_id?: string;
              jti?: string;
              zentity_release_id?: string;
            };
          }
        ).jwt;
        const clientId = jwt?.azp ?? jwt?.client_id;
        const releaseId = jwt?.zentity_release_id;
        const scopeList = toScopeList(scopes);
        const hasIdentityScopes = extractIdentityScopes(scopeList).length > 0;

        const proofClaims = hasAnyProofScope(scopeList)
          ? filterProofClaimsByScopes(
              await buildProofClaims(user.id),
              scopeList,
              "userinfo"
            )
          : {};

        let releaseContext: ReleaseContext | null = null;
        if (releaseId) {
          if (!clientId) {
            throw invalidTokenDisclosureError("release_context_client_missing");
          }
          try {
            releaseContext = await validateReleaseContextForSubject({
              releaseId,
              clientId,
              userId: user.id,
            });
          } catch (error) {
            if (error instanceof DisclosureBindingError) {
              identityReleaseLog.warn(
                {
                  event: "binding_miss",
                  userId: user.id,
                  clientId,
                  releaseId,
                },
                error.reason
              );
              throw toDisclosureApiError(error);
            }
            throw error;
          }
        } else if (!clientId && hasIdentityScopes) {
          identityReleaseLog.warn(
            {
              event: "fail_closed",
              userId: user.id,
              scopesPresent: scopeList,
              jtiPresent: !!jwt?.jti,
            },
            "azp missing on token with identity scopes — no PII delivered"
          );
        }

        const payload =
          releaseContext?.expectsIdentityPayload && releaseId
            ? consumeReleaseIdentityPayload(releaseId)
            : null;

        if (releaseContext?.expectsIdentityPayload) {
          if (!(payload && clientId)) {
            throw invalidTokenDisclosureError("identity_payload_missing");
          }
          if (
            payload.meta.clientId !== clientId ||
            (releaseContext.scopeHash &&
              payload.meta.scopeHash !== releaseContext.scopeHash)
          ) {
            throw invalidTokenDisclosureError("identity_payload_mismatch");
          }
        }

        const identityClaims =
          payload && releaseContext
            ? filterIdentityByScopes(
                payload.claims,
                releaseContext.approvedIdentityScopes.length > 0
                  ? releaseContext.approvedIdentityScopes
                  : payload.scopes
              )
            : {};

        const allClaims = { ...identityClaims, ...proofClaims };
        const userinfoFilter = claimsRequestForEndpoint(
          releaseContext?.claimsRequest ?? null,
          "userinfo"
        );
        return filterClaimsByRequest(allClaims, userinfoFilter);
      },
    }),
    exactDisclosureClaimsPlugin(),
    oidc4ida({
      getVerifiedClaims: async ({ user }: { user: { id: string } }) =>
        buildOidcVerifiedClaims(user.id),
    }) as BetterAuthPlugin,
    oidc4vci({
      defaultWalletClientId: "zentity-wallet",
      credentialIssuer: authIssuer,
      issuerBaseURL: authIssuer,
      credentialAudience: oidc4vciCredentialAudience,
      accessTokenJwksUrl: joinAuthIssuerPath(authIssuer, "oauth2/jwks"),
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
      buildAccessTokenClaims: async (cibaRequest) => {
        // Stash authContextId while the CIBA request still exists —
        // the after-hook needs it to persist on the opaque token record.
        const authCtxId = (cibaRequest as { authContextId?: string })
          .authContextId;
        if (authCtxId) {
          pendingCibaAuthContext.set(cibaRequest.authReqId, authCtxId);
        }
        const accessTokenClaims = await persistAapSnapshotForCibaToken(
          cibaRequest.authReqId,
          cibaRequest.clientId
        );
        const releaseContext = await loadReleaseContext(cibaRequest.authReqId);
        if (
          releaseContext?.expectsIdentityPayload &&
          !hasIdentityPayload(finalReleaseIdentityKey(cibaRequest.authReqId))
        ) {
          throw invalidGrantDisclosureError("identity_payload_missing");
        }
        const claims: Record<string, unknown> = {
          jti: cibaRequest.authReqId,
        };

        if (releaseContext) {
          await touchReleaseContext(
            cibaRequest.authReqId,
            Date.now() + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000
          );
          claims.zentity_release_id = cibaRequest.authReqId;
        }

        if (!accessTokenClaims) {
          return claims;
        }

        return {
          ...claims,
          ...(accessTokenClaims.agent?.id
            ? { act: { sub: accessTokenClaims.agent.id } }
            : {}),
          ...(accessTokenClaims as unknown as Record<string, unknown>),
        };
      },
      sendNotification: async (data, request) => {
        let agentName: string | undefined;
        let registeredAgent:
          | {
              attestationProvider?: string | null;
              attestationTier?: string | null;
              model?: string | null;
              name: string;
              runtime?: string | null;
              version?: string | null;
            }
          | undefined;
        let verifiedSessionId: string | undefined;
        const authDetails = normalizeAuthorizationDetails(
          data.authorizationDetails
        );
        const assertionHeader = request?.headers.get("Agent-Assertion");
        if (assertionHeader) {
          const boundAssertion = await bindAgentAssertionToCibaRequest({
            assertionJwt: assertionHeader,
            authReqId: data.authReqId,
            authorizationDetails: authDetails,
            scope: data.scope,
          });
          if (boundAssertion) {
            verifiedSessionId = boundAssertion.sessionId;
            agentName = boundAssertion.agentName;
            registeredAgent = boundAssertion.registeredAgent;
          }
        }

        // Self-declared agent_claims are never trusted for token claims.
        // Keep agent metadata sourced only from a verified Agent-Assertion / AAP snapshot.
        if (!verifiedSessionId) {
          await db
            .update(cibaRequests)
            .set({ agentClaims: null })
            .where(eq(cibaRequests.authReqId, data.authReqId))
            .run();
        }

        // Capability grant evaluation for registered agents
        let requiresBiometric = false;
        if (verifiedSessionId) {
          const grantResult = await evaluateSessionGrants(
            verifiedSessionId,
            data.scope,
            authDetails
          );
          const approvalAuth = grantResult.approved
            ? await getAuthenticationStateBySessionId(verifiedSessionId)
            : null;
          if (grantResult.approvalStrength === "biometric") {
            requiresBiometric = true;
          }
          if (grantResult.approved && approvalAuth) {
            const updated = await db
              .update(cibaRequests)
              .set({
                status: "approved",
                authContextId: approvalAuth.id,
                approvalMethod: "capability_grant",
                approvedCapabilityName:
                  grantResult.capabilityName ??
                  deriveCapabilityName(authDetails, data.scope),
                approvedConstraints: grantResult.constraintsJson,
                approvedGrantId: grantResult.grantId,
                approvedHostPolicyId: grantResult.hostPolicyId,
                approvalStrength: grantResult.approvalStrength,
              })
              .where(
                and(
                  eq(cibaRequests.authReqId, data.authReqId),
                  eq(cibaRequests.status, "pending")
                )
              )
              .returning({ id: cibaRequests.id });

            if (updated.length > 0) {
              const cibaRow = await db
                .select({
                  deliveryMode: cibaRequests.deliveryMode,
                  clientNotificationEndpoint:
                    cibaRequests.clientNotificationEndpoint,
                  clientNotificationToken: cibaRequests.clientNotificationToken,
                })
                .from(cibaRequests)
                .where(eq(cibaRequests.authReqId, data.authReqId))
                .limit(1)
                .get();

              if (
                cibaRow?.deliveryMode === "ping" &&
                cibaRow.clientNotificationEndpoint &&
                cibaRow.clientNotificationToken
              ) {
                deliverPing(
                  cibaRow.clientNotificationEndpoint,
                  cibaRow.clientNotificationToken,
                  data.authReqId
                ).catch(() => undefined);
              }
              return;
            }
          }
        }

        const origin = getAppOrigin();
        const pushPayload = buildCibaPushPayload(
          { ...data, agentName, requiresBiometric },
          origin
        );
        await Promise.allSettled([
          sendWebPush(data.userId, pushPayload),
          sendCibaNotification({
            userId: data.userId,
            authReqId: data.authReqId,
            clientName: data.clientName,
            scope: data.scope,
            bindingMessage: data.bindingMessage,
            authorizationDetails: data.authorizationDetails,
            registeredAgent,
            approvalUrl: pushPayload.data.approvalUrl,
          }),
        ]);
      },
    }),
    tokenExchangePlugin(),
  ],
});

export type Session = typeof auth.$Infer.Session;
