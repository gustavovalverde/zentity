import type { CibaNotification } from "@better-auth/ciba";
import type { AuthContext, GenericEndpointContext } from "@better-auth/core";
import type { LoginMethod } from "@zentity/sdk/protocol";

import { CIBA_GRANT_TYPE, ciba } from "@better-auth/ciba";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import {
  defineRequestState,
  tryGetCurrentAuthEndpointContext,
} from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  createDcqlMatcher,
  createJarmHandler,
  createKeyAttestationValidator,
  createVpSessionResolver,
  createX5cHeaders,
  haip,
  type TrustedIssuer,
} from "@better-auth/haip";
import {
  extendOAuthProvider,
  type OAuthClaimExtensionInput,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { type Oidc4vciOptions, oidc4vci } from "@better-auth/oidc4vci";
import { oidc4vp } from "@better-auth/oidc4vp";
import { passkey } from "@better-auth/passkey";
import { setGlobalConfig as setOpenid4vcConfig } from "@openid4vc/utils";
import {
  AGENT_BOOTSTRAP_SCOPES,
  AGENT_SESSION_INACTIVE_DESCRIPTION,
} from "@zentity/sdk/agent-contract";
import {
  AUTHORIZATION_DETAILS_TYPES,
  decodeJwtPayloadStrict,
  PAYMENT_AUTHORIZATION_TYPE,
  X402_PURCHASE_TYPE,
} from "@zentity/sdk/protocol";
import { APIError, type BetterAuthPlugin, betterAuth } from "better-auth";
import {
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous, jwt, magicLink } from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { decodeJwt, jwtVerify } from "jose";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { env } from "@/env";
import { evaluateSessionGrants } from "@/lib/agents/approval-evaluate";
import {
  agentApprovalFor,
  recordApprovalToken,
} from "@/lib/agents/approval-record";
import {
  type ApprovalPolicy,
  approvalPolicy,
  normalizeAuthorizationDetails,
} from "@/lib/agents/capability";
import { buildCibaPushPayload, sendWebPush } from "@/lib/agents/push-sender";
import {
  bindAgentAssertionToCibaRequest,
  verifyAgentAssertionForRequest,
} from "@/lib/agents/session";
import {
  ACR_VALUES_SUPPORTED,
  buildNamespacedAssuranceClaim,
  computeAcr,
  loginMethodToAmr,
} from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import {
  createSessionAuthenticationContext,
  deleteUnreferencedAuthenticationContext,
  getAuthenticationStateBySessionId,
  resolveAuthenticationContext,
} from "@/lib/auth/auth-context";
import { getHardenedJWKSet } from "@/lib/auth/jwt";
import {
  cibaApprovalPlugin,
  cibaApprovalUrl,
  createCibaApproval,
  getPendingCibaToken,
  setPendingCibaToken,
} from "@/lib/auth/oidc/ciba";
import { clientMetadataExtension } from "@/lib/auth/oidc/client-metadata";
import {
  buildCredentialClaims,
  buildProofClaims,
  computeConsentHmac,
  computeConsentReferenceId,
  filterClaimsByRequest,
  PROOF_DISCLOSURE_KEYS,
} from "@/lib/auth/oidc/disclosure/claims";
import {
  claimsRequestForEndpoint,
  consumeReleaseIdentityPayload,
  DisclosureBindingError,
  finalizeOauthDisclosureFromVerification,
  hasReleaseContext,
  loadReleaseContext,
  RELEASE_BINDING_CLAIM,
  type ReleaseContext,
  releaseIdFor,
  touchReleaseContext,
  validateReleaseContextForSubject,
} from "@/lib/auth/oidc/disclosure/context";
import {
  finalReleaseIdentityKey,
  hasIdentityPayload,
} from "@/lib/auth/oidc/disclosure/delivery";
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
} from "@/lib/auth/oidc/disclosure/registry";
import { verifiedClaimsPlugin } from "@/lib/auth/oidc/disclosure/verified-claims";
import {
  deleteExpiredFirstPartyRows,
  firstPartyAppsPlugin,
} from "@/lib/auth/oidc/first-party-apps";
import { getJarmDecryptionKey } from "@/lib/auth/oidc/haip/jarm-key";
import {
  getProtectedResourceAudiences,
  normalizeUserTokenResources,
  refuseWalletAudience,
} from "@/lib/auth/oidc/haip/resource-metadata";
import { loadX5cChain } from "@/lib/auth/oidc/haip/x5c-chain";
import {
  getPublishedJwks,
  signingKeyOptions,
  signJwt,
} from "@/lib/auth/oidc/jwt-signer";
import { oauthProviderApi } from "@/lib/auth/oidc/oauth-provider";
import {
  authorizeRequestParameters,
  validateResourceUri,
} from "@/lib/auth/oidc/oauth-request";
import {
  findPairwiseClient,
  keepsSector,
  pairwiseRedirectUriProblem,
  rememberAccessTokenIssuance,
  resolveSubForClientId,
  resolveUserIdFromSub,
} from "@/lib/auth/oidc/pairwise";
import { deletePairwiseSubjectsForUser } from "@/lib/auth/oidc/pairwise-subject-index";
import {
  pinPaymentRequest,
  registersPaymentAuthorization,
} from "@/lib/auth/oidc/payment-mint";
import {
  acceptsX402Purchase,
  pinPurchaseRequest,
} from "@/lib/auth/oidc/purchase-request";
import { resourceAccessTokenPlugin } from "@/lib/auth/oidc/resource-access-token";
import {
  invalidAccessToken,
  type ResourceError,
} from "@/lib/auth/oidc/resource-challenge";
import {
  enforceAuthorizeAcr,
  enforceCibaTokenAcr,
  rememberPushedAcrRequest,
} from "@/lib/auth/oidc/step-up";
import { resolveSybilNullifier } from "@/lib/auth/oidc/sybil";
import { tokenExchangePlugin } from "@/lib/auth/oidc/token-exchange";
import { recordRevokedAccessToken } from "@/lib/auth/oidc/token-revocation";
import { BUILT_IN_WALLET_CLIENT_ID } from "@/lib/auth/oidc/wallet-dcr";
import {
  discoveryMetadataExtension,
  getAuthIssuer,
  joinAuthIssuerPath,
} from "@/lib/auth/oidc/well-known";
import { opaque } from "@/lib/auth/opaque/server";
import { getTrustedOrigins, PASSKEY_RP_ID } from "@/lib/auth/origin";
import {
  authorizePasskeyEnrollment,
  authorizePasswordChange,
  notifyRecoveryFactorChange,
  readMagicLinkEmail,
  recoveryFactorsPlugin,
} from "@/lib/auth/recovery-factors";
import { canManageOAuthClients } from "@/lib/auth/rp-admin";
import { siweAuth } from "@/lib/auth/siwe/server";
import {
  ANONYMOUS_EMAIL_DOMAIN,
  WALLET_EMAIL_DOMAIN,
} from "@/lib/auth/synthetic-email";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import {
  denyPendingCibaRequestsForUser,
  findCibaApproval,
} from "@/lib/db/queries/ciba";
import { getActiveHumanityCredentials } from "@/lib/db/queries/humanity";
import { detachVaultCredential } from "@/lib/db/queries/privacy";
import {
  accounts,
  passkeys,
  sessions,
  users,
  verifications,
  walletAddresses,
} from "@/lib/db/schema/auth";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  firstPartyAuthSessions,
  firstPartyFailureBudgets,
  haipVpSessions,
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
} from "@/lib/db/schema/oauth-provider";
import {
  oidc4vciIssuedCredentials,
  oidc4vciOffers,
} from "@/lib/db/schema/oidc-credentials";
import {
  invitations,
  members,
  organizations,
} from "@/lib/db/schema/organization";
import { sendCibaNotification } from "@/lib/email/ciba";
import { clientIpAddressOptions } from "@/lib/http/rate-limit";
import { validateOutboundUrl } from "@/lib/http/url-safety";
import { resolveRpUniqueHumanityClaim } from "@/lib/identity/humanity/nullifier";
import { logError } from "@/lib/logging/error-logger";
import { logger as rootLogger } from "@/lib/logging/logger";
import {
  getConsentHmacKey,
  getConsentReferenceKey,
} from "@/lib/privacy/primitives/derived-keys";
import { OPAQUE_CREDENTIAL_ID } from "@/lib/privacy/secrets/catalog";

const betterAuthSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  passkey: passkeys,
  walletAddress: walletAddresses,
  oauthClient: oauthClients,
  oauthClientAssertion: oauthClientAssertions,
  oauthRefreshToken: oauthRefreshTokens,
  oauthAccessToken: oauthAccessTokens,
  oauthConsent: oauthConsents,
  oauthResource: oauthResources,
  oauthClientResource: oauthClientResources,
  organization: organizations,
  member: members,
  invitation: invitations,
  jwks,
  oidc4vciOffer: oidc4vciOffers,
  oidc4vciIssuedCredential: oidc4vciIssuedCredentials,
  haipVpSession: haipVpSessions,
  cibaRequest: cibaRequests,
  firstPartyAuthSession: firstPartyAuthSessions,
  firstPartyFailureBudget: firstPartyFailureBudgets,
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

/**
 * Refuses the token of a UserInfo request whose identity release no longer
 * holds. The provider accepted the token, so the refusal carries its own
 * challenge, in the scheme the request presented the token with.
 */
function userInfoReleaseError(reason: string): ResourceError {
  return invalidAccessToken(
    tryGetCurrentAuthEndpointContext()?.request,
    reason
  );
}

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
  if (path.includes("/siwe/")) {
    return "eip712";
  }
  if (path.startsWith("/sign-in/email") || path.startsWith("/sign-up/email")) {
    return "credential";
  }
  return null;
};

const identityReleaseLog = rootLogger.child({
  component: "identity-release",
});

const cimdLog = rootLogger.child({ component: "cimd" });

// The CIMD plugin persists only the standard OAuth client fields. CIMD clients
// are dynamic and untrusted, so stamp Zentity's posture columns: a pairwise
// subject (per-RP privacy), the discovery trust tier, and the metadata
// source/timestamp for audit and staleness. The sector is the client's own,
// `client/<client_id>`, because one host can serve many tenants' documents.
// The plugin calls this only after the provider commits a refresh, and each
// refresh first stores the provider's own derivation, the first redirect host
// when every redirect URI is https. `originBoundFields` keeps that host on the
// document's own origin meanwhile, so the interval never names another
// relying party. The refreshed object goes back to the request that resolved
// it, which may mint an ID token, so the posture is applied to the object as
// well as the row, and a write that fails refuses that request.
async function applyCimdClientPosture(client: { clientId: string }) {
  const posture = {
    metadataUrl: client.clientId,
    metadataFetchedAt: new Date(),
    trustLevel: 1,
    subjectType: "pairwise",
    sectorIdentifier: `client/${client.clientId}`,
  };
  try {
    await db
      .update(oauthClients)
      .set(posture)
      .where(eq(oauthClients.clientId, client.clientId))
      .run();
  } catch (error) {
    Object.assign(client, { disabled: true });
    throw error;
  }
  Object.assign(client, posture);
}

const cimdOptions = {
  fetchClientMetadataResource,
  metadataProfile: "mcp-2026-07-28" as const,
  // Loopback and private-use redirect URIs stay exempt (RFC 8252).
  originBoundFields: [
    "redirect_uris",
    "post_logout_redirect_uris",
    "client_uri",
  ],
  onClientCreated: async ({ client }: { client: { clientId: string } }) => {
    await applyCimdClientPosture(client);
    cimdLog.info(
      { clientId: client.clientId },
      "CIMD client registered from metadata document"
    );
  },
  onClientRefreshed: async ({
    client,
  }: {
    client: {
      clientId: string;
      redirectUris?: unknown;
      grantTypes?: unknown;
      tokenEndpointAuthMethod?: unknown;
    };
  }) => {
    await applyCimdClientPosture(client);
    // Security-relevant client metadata can change between refreshes; record each
    // refresh for audit. The plugin re-validates the document first.
    cimdLog.info(
      {
        clientId: client.clientId,
        redirectUris: client.redirectUris,
        grantTypes: client.grantTypes,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      },
      "CIMD client metadata refreshed"
    );
  },
};

const authIssuer = getAuthIssuer();
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
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
  "compliance:read",
  "email",
  "proof:humanity",
  "proof:humanity:rp_unique",
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
// ID token claims that the authentication context and Zentity's claim
// contributors add; the provider advertises only the names listed here.
const ID_TOKEN_ASSURANCE_CLAIMS = [
  "acr",
  "amr",
  "auth_time",
  "acr_eidas",
  "at_hash",
];
const advertisedClaims = Array.from(
  new Set([
    ...oidcStandardClaims,
    ...PROOF_DISCLOSURE_KEYS,
    ...identityClaimKeys,
    ...ID_TOKEN_ASSURANCE_CLAIMS,
  ])
);
const isOidcE2e = env.E2E_OIDC_ONLY === true;
const isPlaywrightE2e =
  typeof process.env.E2E_DATABASE_PATH === "string" ||
  typeof process.env.E2E_TURSO_DATABASE_URL === "string";
const enableEmailAndPassword = isOidcE2e || isPlaywrightE2e;
// No `scope` here: the plugin would then issue a credential to any token
// carrying that scope, and `identity_verification` is a hidden scope that
// consent grants without showing it. Issuance stays bound to the token's
// credential configuration; the metadata route advertises the scope (HAIP §4.1).
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
const isDev = process.env.NODE_ENV !== "production";

const x5cChain = loadX5cChain();

// The @openid4vc libraries behind oidc4vci and oidc4vp reject http:// URLs.
// Development and e2e serve the issuer and verifier over http.
if (isDev) {
  setOpenid4vcConfig({ allowInsecureUrls: true });
}

// HAIP §4.4: wallet providers whose client attestations and key attestations
// Zentity accepts. Without any, wallets authenticate as public clients and
// prove keys with `jwt` proofs only.
const trustedWalletIssuers = env.TRUSTED_WALLET_ISSUERS as
  | TrustedIssuer[]
  | undefined;

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
      claims = decodeJwtPayloadStrict(softwareStatement);
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

    const issuerProblem = validateOutboundUrl(iss);
    if (issuerProblem) {
      throw new APIError("BAD_REQUEST", {
        error_description: `software_statement issuer ${issuerProblem}`,
      });
    }

    const jwks = getHardenedJWKSet(
      joinAuthIssuerPath(iss, ".well-known/jwks.json")
    );
    if (!jwks) {
      throw new APIError("BAD_REQUEST", {
        error_description: "software_statement issuer JWKS URL is not allowed",
      });
    }
    try {
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

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * Gives a before-hook every `resource` value of a form body. Hooks see one
 * value per key, and the endpoint restores the repeated values afterwards
 * unless a hook replaced the value, so a check on the collapsed body would
 * miss all but the last indicator (RFC 8707 §2 allows repeats). Interim until
 * hooks see repeated values (U26 in docs/adr/platform/0002-better-auth-patches.md).
 */
async function readRepeatedFormResources(ctx: HookCtx): Promise<void> {
  const request = ctx.request;
  if (
    !(
      ctx.body &&
      request?.headers.get("content-type")?.includes(FORM_CONTENT_TYPE)
    )
  ) {
    return;
  }
  const values = new URLSearchParams(await request.clone().text())
    .getAll("resource")
    .filter(Boolean);
  if (values.length > 1) {
    ctx.body.resource = values;
  }
}

const ACCESS_TOKEN_SCHEME_RE = /^(Bearer|DPoP)\s+/i;

const USER_TOKEN_GRANT_TYPES = new Set<unknown>([
  "authorization_code",
  "refresh_token",
  CIBA_GRANT_TYPE,
]);

const LOOPBACK_REDIRECT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackRedirectUri(uri: unknown): boolean {
  if (typeof uri !== "string" || !URL.canParse(uri)) {
    return false;
  }
  const url = new URL(uri);
  return url.protocol === "http:" && LOOPBACK_REDIRECT_HOSTS.has(url.hostname);
}

// RFC 8252 §7.3: all-loopback redirects identify a native app, which OIDC DCR would default to "web".
function inferNativeApplicationType(body: Record<string, unknown>) {
  const redirectUris = body.redirect_uris;
  if (
    body.application_type === undefined &&
    Array.isArray(redirectUris) &&
    redirectUris.length > 0 &&
    redirectUris.every(isLoopbackRedirectUri)
  ) {
    body.application_type = "native";
  }
}

function invalidClientMetadata(description: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_client_metadata",
    error_description: description,
  });
}

// Anyone may register, so a client never chooses public subjects, which would
// name every user by the same id at every client.
async function beforeDcrRegister(ctx: HookCtx) {
  await validateDcrRegistration(ctx.body);
  if (!ctx.body) {
    return;
  }
  inferNativeApplicationType(ctx.body);
  if (ctx.body.subject_type === "public") {
    throw invalidClientMetadata(
      'subject_type "public" is not supported; clients receive pairwise subject identifiers'
    );
  }
  ctx.body.subject_type ??= "pairwise";
}

// `/oauth2/create-client` takes no `subject_type` and would register a public
// client (U24 in docs/adr/platform/0002-better-auth-patches.md). Its
// redirect URIs must satisfy the provider's pairwise rules, and the after-hook
// makes the new client pairwise.
function beforeCreateClientRequirePairwiseRedirects(ctx: HookCtx) {
  const redirectUris: unknown = ctx.body?.redirect_uris;
  if (!Array.isArray(redirectUris)) {
    return;
  }
  const problem = pairwiseRedirectUriProblem(
    redirectUris.filter((uri): uri is string => typeof uri === "string")
  );
  if (problem) {
    throw invalidClientMetadata(problem);
  }
}

async function afterCreateClientMakePairwise(ctx: HookCtx) {
  const created = await readReturnedResponseBody(
    (ctx.context as { returned?: unknown }).returned
  );
  const clientId = created?.client_id;
  if (typeof clientId !== "string") {
    return;
  }
  await db
    .update(oauthClients)
    .set({ subjectType: "pairwise" })
    .where(
      and(eq(oauthClients.clientId, clientId), isNull(oauthClients.subjectType))
    )
    .run();
}

// The provider recomputes a client's sector when its redirect URIs change but
// keeps the client's tokens and grants, which would then resolve to the new
// sector's subjects. A pairwise client could so move into another relying
// party's sector and read that party's subject for each of its users. Interim
// until the provider keeps the sector (U22 in
// docs/adr/platform/0002-better-auth-patches.md).
async function beforeUpdateClientKeepSector(ctx: HookCtx) {
  const clientId = ctx.body?.client_id;
  const redirectUris = ctx.body?.update?.redirect_uris;
  if (typeof clientId !== "string" || !Array.isArray(redirectUris)) {
    return;
  }
  const client = await findPairwiseClient(clientId);
  if (
    client?.subjectType !== "pairwise" ||
    keepsSector(clientId, client, redirectUris)
  ) {
    return;
  }
  throw new APIError("BAD_REQUEST", {
    error: "invalid_client_metadata",
    error_description:
      "redirect_uris must keep the client's pairwise sector; register a new client for another host",
  });
}

// Magic-link verification deletes every account row of a user whose email is
// unverified. For OPAQUE and wallet users that row is the only credential.
const EMAIL_PROOF_PROTECTED_PROVIDERS = ["opaque", "eip712"];

async function beforeMagicLinkProtectCredentials(ctx: HookCtx) {
  const token =
    typeof ctx.query?.token === "string" ? ctx.query.token : undefined;
  const email = token ? await readMagicLinkEmail(token) : null;
  if (!email) {
    return;
  }

  const protectedAccount = await db
    .select({ id: accounts.id })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(
      and(
        eq(users.email, email),
        eq(users.emailVerified, false),
        inArray(accounts.providerId, EMAIL_PROOF_PROTECTED_PROVIDERS)
      )
    )
    .limit(1)
    .get();
  if (protectedAccount) {
    throw ctx.redirect(`${appUrl}/sign-in?error=email_unverified`);
  }
}

async function readReturnedResponseBody(
  returned: unknown
): Promise<Record<string, unknown> | null> {
  if (returned instanceof Response) {
    return (await returned
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
  }

  if (!(returned && typeof returned === "object")) {
    return null;
  }

  if ("response" in returned) {
    const response = returned.response;
    return response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : null;
  }

  return returned as Record<string, unknown>;
}

// A JWT access token carries its own audience-scoped subject; the provider
// would present the issuing client's subject instead.
async function afterIntrospectKeepJwtSubject(ctx: HookCtx) {
  const token =
    typeof ctx.body?.token === "string"
      ? ctx.body.token.replace(ACCESS_TOKEN_SCHEME_RE, "")
      : "";
  if (token.split(".").length !== 3) {
    return;
  }
  const introspection = await readReturnedResponseBody(
    (ctx.context as { returned?: unknown }).returned
  );
  if (!introspection?.active) {
    return;
  }
  const { sub } = decodeJwt(token);
  if (typeof sub !== "string") {
    return;
  }
  return ctx.json({ ...introspection, sub });
}

/**
 * Loads what a CIBA token poll needs before the plugin consumes (deletes) the
 * request row: the step-up re-check, the staged identity release, and the
 * approval-time authentication context from the request, and from the
 * approval record its oversight and any verified agent with what it may do.
 * The result is stashed for the claim contributors and the after-hook of the
 * same request. A refusal here leaves the approved request in place for
 * another poll.
 */
async function beforeCibaTokenLoadRequest(ctx: HookCtx) {
  const rawAuthReqId = ctx.body?.auth_req_id;
  if (typeof rawAuthReqId !== "string" || !rawAuthReqId) {
    return;
  }
  const authReqIdHash = await oauthProviderApi(ctx).hashToken(
    rawAuthReqId,
    "auth_req_id"
  );
  const row = await db
    .select()
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqIdHash))
    .limit(1)
    .get();
  if (row?.status !== "approved") {
    return;
  }
  await enforceCibaTokenAcr(ctx, row);

  const releaseId = releaseIdFor(authReqIdHash, row.clientId);
  const releaseContext = await loadReleaseContext(releaseId);
  if (
    releaseContext?.expectsIdentityPayload &&
    !hasIdentityPayload(finalReleaseIdentityKey(releaseId))
  ) {
    throw invalidGrantDisclosureError("identity_payload_missing");
  }
  if (releaseContext) {
    await touchReleaseContext(releaseId, Date.now() + 3600 * 1000);
  }

  const approval = await findCibaApproval(authReqIdHash);
  const agent = approval ? agentApprovalFor(approval) : null;
  await setPendingCibaToken({
    agentSessionId: agent?.sessionId ?? null,
    authorization: agent?.authorization ?? null,
    authContextId: row.authContextId ?? "",
    authReqIdHash,
    oversight: approval?.approvalMethod
      ? {
          method: approval.approvalMethod,
          approved_at: Math.floor(approval.decidedAt.getTime() / 1000),
        }
      : null,
  });
}

/**
 * Drains the CIBA token stash after `/oauth2/token`: writes the approval-time
 * authentication context onto the issued access token record (a Zentity
 * extension column the upstream issuance does not set, so no token or
 * introspection response carries it), and records the issued token on the
 * approval, whose `reference_id` every CIBA token carries as its own.
 * Introspection finds the approval of a JWT by that `jti` and of an opaque
 * token by its `reference_id`.
 */
async function afterCibaTokenPersist(ctx: HookCtx) {
  const pending = await getPendingCibaToken();
  if (!pending) {
    return;
  }
  const { authReqIdHash } = pending;

  if (pending.authContextId) {
    await db
      .update(oauthAccessTokens)
      .set({ authContextId: pending.authContextId })
      .where(eq(oauthAccessTokens.referenceId, authReqIdHash))
      .run();
  }

  const responseBody = await readReturnedResponseBody(
    (ctx.context as { returned?: unknown }).returned
  );
  const accessToken = responseBody?.access_token;
  if (typeof accessToken === "string") {
    await recordApprovalToken({ accessToken, referenceId: authReqIdHash });
  }
}

/**
 * Rebinds an authorization code to its own reference before the grant redeems
 * it, so every token the code issues references this one authorization rather
 * than the consent it shares with later sign-ins, then finalizes any identity
 * release the authorization staged against that reference.
 */
async function beforeTokenFinalizeDisclosureBindings(ctx: HookCtx) {
  const code = typeof ctx.body?.code === "string" ? ctx.body.code : undefined;
  if (!code) {
    return;
  }

  const record = await findAuthorizationCodeRecord(ctx, code);
  if (!record) {
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

  const authorizationId = record.identifier;
  if (stored.referenceId !== authorizationId) {
    await db
      .update(verifications)
      .set({
        value: JSON.stringify({ ...stored, referenceId: authorizationId }),
      })
      .where(eq(verifications.identifier, authorizationId))
      .run();
  }

  try {
    await finalizeOauthDisclosureFromVerification({
      authorizationId,
      query: stored.query ?? {},
      userId: stored.userId,
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

async function findAuthorizationCodeRecord(
  ctx: HookCtx,
  code: string
): Promise<{ identifier: string; value: string } | null> {
  const identifier = await oauthProviderApi(ctx).hashToken(
    code,
    "authorization_code"
  );
  const record = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1)
    .get();
  return record?.value ? { identifier, value: record.value } : null;
}

async function pendingCibaAuthContextId(
  referenceId: string | undefined
): Promise<string | undefined> {
  if (!referenceId) {
    return undefined;
  }
  const pending = await getPendingCibaToken();
  return pending?.authReqIdHash === referenceId
    ? pending.authContextId
    : undefined;
}

async function buildIdTokenDisclosureClaims(input: {
  authContextId?: string | null;
  clientId?: string;
  referenceId?: string;
  scopes: unknown;
  sessionId?: string | null;
  user: { id: string };
}): Promise<Record<string, unknown>> {
  const scopeList = toScopeList(input.scopes);
  const cibaAuthContextId = await pendingCibaAuthContextId(input.referenceId);
  const auth = await resolveAuthenticationContext({
    authContextId: input.authContextId ?? (cibaAuthContextId || null),
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
    if (!auth) {
      throw invalidGrantDisclosureError(
        "Authentication context required for ID token issuance"
      );
    }
    const assurance = await getAccountAssurance(input.user.id, {
      isAuthenticated: true,
    });
    assuranceClaims = {
      ...buildNamespacedAssuranceClaim(assurance, auth),
    };
  }

  const releaseContext =
    input.referenceId && input.clientId
      ? await loadReleaseContext(
          releaseIdFor(input.referenceId, input.clientId)
        )
      : null;
  const idTokenFilter = claimsRequestForEndpoint(
    releaseContext?.claimsRequest ?? null,
    "id_token"
  );

  // The claims-request parameter filters the standard/proof claims it can name.
  // The namespaced zentity_assurance claim is always included when it applies,
  // like any zentity-owned claim a client cannot opt out of.
  return {
    ...filterClaimsByRequest(proofClaims, idTokenFilter),
    ...assuranceClaims,
  };
}

async function buildAccessTokenDisclosureClaims(
  info: OAuthClaimExtensionInput
): Promise<Record<string, unknown>> {
  const userId = info.user?.id;
  if (!userId) {
    return {};
  }
  // signJwt reads it to give a JWT its audience's subject.
  await rememberAccessTokenIssuance({
    userId,
    client: {
      clientId: info.client.clientId,
      redirectUris: info.client.redirectUris ?? [],
      sectorIdentifier: info.client.sectorIdentifier ?? null,
    },
  });
  const clientId = info.client?.clientId;
  const referenceId = info.referenceId;
  const scopeList = toScopeList(info.scopes);
  const claims: Record<string, unknown> = {};
  // Per-RP anti-abuse handles stay in tokens only Zentity reads (ADR
  // privacy/0015 rule 5). Zentity-hosted resources are dropped before
  // issuance, so a token with resources is a JWT for an outside audience.
  const isOpaqueToken = (info.resources?.length ?? 0) === 0;

  if (isOpaqueToken && scopeList.includes("proof:sybil") && clientId) {
    const nullifier = await resolveSybilNullifier(userId, clientId);
    if (nullifier) {
      claims.sybil_nullifier = nullifier;
    }
  }

  if (
    isOpaqueToken &&
    scopeList.includes("proof:humanity:rp_unique") &&
    clientId
  ) {
    const credentials = await getActiveHumanityCredentials(userId);
    const humanity = resolveRpUniqueHumanityClaim({
      clientId,
      providerSubjectHashes: credentials.map(
        (credential) => credential.providerSubjectHash
      ),
    });
    if (humanity) {
      claims.rp_unique_humanity_id = humanity.rp_unique_humanity_id;
    }
  }

  // Extend the identity-payload TTL whenever a token is minted for a
  // release-bound request so the payload survives until userinfo consumes it.
  if (referenceId && clientId) {
    const releaseContext = await loadReleaseContext(
      releaseIdFor(referenceId, clientId)
    );
    if (releaseContext) {
      await touchReleaseContext(
        releaseContext.releaseId,
        Date.now() + 3600 * 1000
      );
      claims[RELEASE_BINDING_CLAIM] = releaseContext.releaseId;
    }
  }

  return claims;
}

function exactDisclosureClaimsPlugin(): BetterAuthPlugin {
  return {
    id: "exact-disclosure-claims",
    init(ctx: AuthContext) {
      extendOAuthProvider(ctx, {
        claims: {
          idToken: async (info: OAuthClaimExtensionInput) => {
            if (!info.user?.id) {
              return {};
            }
            // Indexes the subject this client receives so it can name the user back.
            if (info.client?.clientId) {
              await resolveSubForClientId(info.user.id, info.client.clientId);
            }
            // sessionId is present on the plain authorization_code path; it is
            // undefined for client_credentials / opaque introspection, where
            // the authentication context falls back to referenceId/userId.
            return buildIdTokenDisclosureClaims({
              authContextId: null,
              ...(info.client?.clientId
                ? { clientId: info.client.clientId }
                : {}),
              ...(info.referenceId ? { referenceId: info.referenceId } : {}),
              scopes: info.scopes,
              ...(info.sessionId === undefined
                ? {}
                : { sessionId: info.sessionId }),
              user: { id: info.user.id },
            });
          },
          accessToken: (info: OAuthClaimExtensionInput) =>
            buildAccessTokenDisclosureClaims(info),
        },
      });
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
  const resource: unknown = ctx.body?.resource;
  for (const value of Array.isArray(resource) ? resource : [resource]) {
    const result = validateResourceUri(value);
    if (!result.valid) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: result.error,
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

async function beforeAuthorizeVerifyConsentHmac(
  ctx: HookCtx,
  request: Record<string, unknown>
) {
  const session = await getSessionFromCtx(ctx);
  const userId = session?.user?.id;
  const clientId =
    typeof request.client_id === "string" ? request.client_id : undefined;
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

  if (consent.scopeHmac === expected) {
    return;
  }

  // The oauth-provider consent endpoint creates the consent row with no
  // `scope_hmac` (better-auth does not know the column), then re-invokes
  // `/oauth2/authorize` inside the same `/oauth2/consent` request, which runs
  // this hook. A null HMAC seen on that internal re-invoke is the trusted,
  // just-created row, so stamp it: better-auth strips unknown fields from its
  // own writes, so the integrity stamp has to be written here, via Drizzle.
  // Any other mismatch is a tampered row reached on a genuine authorize, so
  // delete it. The path combination (authorize hook running for a `/oauth2/
  // consent` request) only occurs on that internal re-invoke.
  const isConsentReinvoke =
    consent.scopeHmac == null && isConsentSubmitRequest(ctx);
  if (isConsentReinvoke) {
    await db
      .update(oauthConsents)
      .set({ scopeHmac: expected })
      .where(eq(oauthConsents.id, consent.id))
      .run();
    return;
  }

  await db.delete(oauthConsents).where(eq(oauthConsents.id, consent.id)).run();
}

function isConsentSubmitRequest(ctx: HookCtx): boolean {
  const url = ctx.request?.url;
  if (!url) {
    return false;
  }
  try {
    return new URL(url).pathname.endsWith("/oauth2/consent");
  } catch {
    return false;
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

async function afterParRememberAcr(ctx: HookCtx) {
  const pushed = await readReturnedResponseBody(
    (ctx.context as { returned?: unknown }).returned
  );
  if (typeof pushed?.request_uri === "string") {
    await rememberPushedAcrRequest(ctx, pushed.request_uri);
  }
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

/** The user-verified flag of this request's passkey ceremony. */
const passkeyUserVerified = defineRequestState<boolean>(() => false);

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
    ...(authMethod === "passkey"
      ? {
          amr: loginMethodToAmr("passkey", {
            userVerified: await passkeyUserVerified.get(),
          }),
        }
      : {}),
    sourceKind: "better_auth",
    sessionId: newSession.session.id,
  });

  // Better Auth may have already minted the encrypted session_data cookie
  // before authContextId is written to the session row. Expire it so the next
  // request reloads fresh session metadata from the database.
  expireSessionDataCookie(ctx);
}

// Decisions go through the CIBA plugin's own server endpoint on this instance.
const cibaApproval = createCibaApproval((body) =>
  auth.api.completeCibaRequest({ body })
);

interface RegisteredAgentNotice {
  attestationProvider?: string | null;
  attestationTier?: string | null;
  model?: string | null;
  name: string;
  runtime?: string | null;
  version?: string | null;
}

/**
 * Tries to approve a request from a verified agent session's capability
 * grants, on behalf of the user who owns the agent. The approval carries the
 * authentication with which the user registered the agent session, since no
 * one authenticates for it. Returns whether it was approved; an approval the
 * grants or the request's `acr_values` do not allow falls back to asking the
 * user.
 */
async function approveFromCapabilityGrant(input: {
  agent: { authContextId: string | null; sessionId: string };
  authorizationDetails: ReturnType<typeof normalizeAuthorizationDetails>;
  policy: ApprovalPolicy;
  requestId: string;
  userId: string;
}): Promise<boolean> {
  if (!input.policy.grantCapability) {
    return false;
  }
  // Resolved before evaluation, which consumes usage limits.
  const authentication = await resolveAuthenticationContext({
    authContextId: input.agent.authContextId,
  });
  if (!authentication) {
    return false;
  }
  const grantResult = await evaluateSessionGrants(
    input.agent.sessionId,
    input.policy,
    input.authorizationDetails
  );
  if (!(grantResult.approved && grantResult.capabilityName)) {
    return false;
  }
  try {
    await cibaApproval.approve({
      requestId: input.requestId,
      userId: input.userId,
      authentication,
      channel: "grant",
      grant: {
        method: "capability_grant",
        capabilityName: grantResult.capabilityName,
        constraints: grantResult.constraints ?? null,
        grantId: grantResult.grantId ?? null,
        hostPolicyId: grantResult.hostPolicyId ?? null,
      },
    });
    return true;
  } catch (error) {
    if (isAPIError(error)) {
      return false;
    }
    throw error;
  }
}

function agentAssertionHeader(
  ctx: GenericEndpointContext | HookCtx
): string | null | undefined {
  return (
    ctx.headers?.get("Agent-Assertion") ??
    ctx.request?.headers.get("Agent-Assertion")
  );
}

/**
 * A bc-authorize request that presents an Agent-Assertion must be the request
 * the assertion signed, by a session that is still active. Either failure is
 * refused before the plugin stores or notifies anything, rather than
 * proceeding as an unverified agent; an inactive session gets its own
 * description so the runtime can register a new one.
 */
async function refuseUnverifiedAgentAssertion(
  ctx: HookCtx,
  body: Record<string, unknown>
): Promise<void> {
  const assertion = agentAssertionHeader(ctx);
  if (!assertion) {
    return;
  }
  const outcome = await verifyAgentAssertionForRequest(body, assertion);
  if (outcome !== "verified") {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description:
        outcome === "inactive_session"
          ? AGENT_SESSION_INACTIVE_DESCRIPTION
          : "Agent-Assertion does not match this request",
    });
  }
}

/**
 * CIBA `sendNotification`: binds a verified Agent-Assertion, auto-approves
 * from capability grants when they allow it, and otherwise notifies the user
 * by web push and email with a link to Zentity's approval page.
 */
async function notifyCibaRequest(
  notification: CibaNotification,
  ctx: GenericEndpointContext
): Promise<void> {
  const { requestId, user } = notification;
  const scope = notification.scopes.join(" ");
  const authDetails = normalizeAuthorizationDetails(
    notification.authorizationDetails
  );
  const policy = approvalPolicy({
    scope,
    authorizationDetails: notification.authorizationDetails,
  });
  const stored = await db
    .select({ authReqId: cibaRequests.authReqId })
    .from(cibaRequests)
    .where(eq(cibaRequests.id, requestId))
    .limit(1)
    .get();
  if (!stored) {
    return;
  }

  let agentName: string | undefined;
  let registeredAgent: RegisteredAgentNotice | undefined;
  let verifiedAgent:
    | { authContextId: string | null; sessionId: string }
    | undefined;
  const assertionHeader = agentAssertionHeader(ctx);
  if (assertionHeader) {
    const boundAssertion = await bindAgentAssertionToCibaRequest({
      assertionJwt: assertionHeader,
      authReqId: stored.authReqId,
    });
    if (boundAssertion) {
      verifiedAgent = {
        authContextId: boundAssertion.authContextId,
        sessionId: boundAssertion.sessionId,
      };
      agentName = boundAssertion.agentName;
      registeredAgent = boundAssertion.registeredAgent;
    }
  }

  // Self-declared agent_claims are never trusted for token claims.
  // Keep agent metadata sourced only from a verified Agent-Assertion / AAP snapshot.
  if (!verifiedAgent) {
    await db
      .update(cibaRequests)
      .set({ agentClaims: null })
      .where(eq(cibaRequests.id, requestId))
      .run();
  }

  if (
    verifiedAgent &&
    (await approveFromCapabilityGrant({
      agent: verifiedAgent,
      authorizationDetails: authDetails,
      policy,
      requestId,
      userId: user.id,
    }))
  ) {
    return;
  }

  const approvalUrl = cibaApprovalUrl(appUrl, requestId);
  const pushPayload = buildCibaPushPayload({
    approvalUrl,
    requestId,
    scope,
    agentName,
    authorizationDetails: authDetails,
    bindingMessage: notification.bindingMessage,
    clientName: notification.clientName,
  });
  await Promise.allSettled([
    sendWebPush(user.id, pushPayload, { expiresAt: notification.expiresAt }),
    sendCibaNotification({
      userId: user.id,
      requestId,
      clientName: notification.clientName,
      scope,
      bindingMessage: notification.bindingMessage,
      authorizationDetails: authDetails,
      registeredAgent,
      approvalUrl,
    }),
  ]);
}

// The CIBA plugin also lets a user approve on the provider's consent page via
// `/oauth2/authorize?ciba_request_id=…`. Zentity approves only on its own page,
// which runs the step-up and identity-release checks, so that entry point
// redirects there and the consent and continue endpoints refuse it.
const CIBA_INTERACTION_PARAMETER = "ciba_request_id";

function cibaInteractionRequestId(
  ctx: HookCtx,
  request: Record<string, unknown> | undefined = ctx.query
): string | undefined {
  const direct = request?.[CIBA_INTERACTION_PARAMETER];
  if (typeof direct === "string" && direct) {
    return direct;
  }
  const oauthQuery = ctx.body?.oauth_query ?? ctx.query?.oauth_query;
  if (typeof oauthQuery === "string") {
    return (
      new URLSearchParams(oauthQuery).get(CIBA_INTERACTION_PARAMETER) ??
      undefined
    );
  }
  return undefined;
}

function redirectCibaInteraction(
  ctx: HookCtx,
  request: Record<string, unknown>
) {
  const requestId = cibaInteractionRequestId(ctx, request);
  if (requestId) {
    throw ctx.redirect(cibaApprovalUrl(appUrl, requestId));
  }
}

function rejectCibaInteraction(ctx: HookCtx) {
  if (cibaInteractionRequestId(ctx)) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description:
        "Backchannel requests are approved on Zentity's approval page",
    });
  }
}

const socialProviders = {
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
};

export type SocialProviderId = keyof typeof socialProviders;

export const configuredSocialProviders = Object.keys(
  socialProviders
) as SocialProviderId[];

/**
 * The RAR types the CIBA plugin accepts, one per registered schema, so
 * discovery and bc-authorize cannot disagree about which types exist.
 */
const cibaAuthorizationDetailsTypes = Object.fromEntries(
  Object.entries(AUTHORIZATION_DETAILS_TYPES).map(([type, schema]) => [
    type,
    {
      validate: (
        detail: unknown,
        { client }: { client: { metadata?: string | object | undefined } }
      ) => {
        const parsed = schema.safeParse(detail);
        if (!parsed.success) {
          return false;
        }
        if (type === PAYMENT_AUTHORIZATION_TYPE) {
          // RFC 9396 §10: only a client that registered the type may request
          // a payment. The plugin's own check lets a client that registered
          // no types request any.
          return registersPaymentAuthorization(client.metadata);
        }
        if (type === X402_PURCHASE_TYPE) {
          return acceptsX402Purchase(
            parsed.data as Parameters<typeof acceptsX402Purchase>[0]
          );
        }
        return true;
      },
    },
  ])
);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: betterAuthSchema,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: authIssuer,
  trustedOrigins: getTrustedOrigins(),
  advanced: {
    ipAddress: clientIpAddressOptions,
  },
  rateLimit:
    isPlaywrightE2e || process.env.NODE_ENV === "test"
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
            "/sign-up/siwe/challenge": {
              window: 60,
              max: 5,
            },
            "/sign-up/siwe/complete": {
              window: 60,
              max: 5,
            },
            "/sign-in/siwe/challenge": {
              window: 60,
              max: 10,
            },
            "/sign-in/siwe/complete": {
              window: 60,
              max: 10,
            },
            "/recovery-key/verify": {
              window: 60,
              max: 5,
            },
          },
        },
  disabledPaths: [
    "/admin/impersonate-user",
    "/admin/stop-impersonating",
    ...(enableEmailAndPassword
      ? []
      : [
          "/sign-in/email",
          "/sign-up/email",
          "/request-password-reset",
          "/recovery/password/reset",
          "/change-password",
          "/set-password",
          "/verify-password",
        ]),
  ],
  emailAndPassword: enableEmailAndPassword
    ? { enabled: true }
    : { enabled: false },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendEmailVerification } = await import("@/lib/email/auth");
      await sendEmailVerification({ user, url });
    },
  },
  user: {
    deleteUser: {
      enabled: true,
      // Runs only once the endpoint's checks pass, so a refused deletion
      // leaves the vault and identity data in place.
      beforeDelete: async (user) => {
        const [
          { deleteIdentityData },
          { deleteBlockchainAttestationsByUserId },
        ] = await Promise.all([
          import("@/lib/db/queries/identity"),
          import("@/lib/db/queries/attestation"),
        ]);
        await deleteIdentityData(user.id);
        await deleteBlockchainAttestationsByUserId(user.id);
      },
    },
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        const { sendChangeEmailConfirmation } = await import(
          "@/lib/email/auth"
        );
        await sendChangeEmailConfirmation({ user, newEmail, url });
      },
    },
  },
  account: {
    encryptOAuthTokens: true,
  },
  databaseHooks: {
    user: {
      delete: {
        before: async (user) => {
          await deletePairwiseSubjectsForUser(user.id);
        },
      },
    },
    session: {
      create: {
        before: async (session) => ({
          data: { ...session, ipAddress: null, userAgent: null },
        }),
      },
      delete: {
        after: async (session, context) => {
          // The challenge endpoint deletes a session it created when the code
          // cannot be issued, or after too many wrong answers. Neither is the
          // user signing out.
          if (context?.path === "/oauth2/authorize-challenge") {
            const { authContextId } = session;
            if (typeof authContextId === "string") {
              await deleteUnreferencedAuthenticationContext(
                authContextId
              ).catch((error: unknown) =>
                logError(error, {
                  userId: session.userId,
                  operation: "first-party-session-cleanup",
                })
              );
            }
            return;
          }
          await denyPendingCibaRequestsForUser(session.userId).catch(
            (error: unknown) =>
              logError(error, {
                userId: session.userId,
                operation: "ciba-logout-rejection",
              })
          );
        },
      },
    },
    verification: {
      create: { before: recordRevokedAccessToken },
    },
  },
  socialProviders,
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
      if (ctx.path === "/oauth2/create-client") {
        return beforeCreateClientRequirePairwiseRedirects(ctx);
      }
      if (
        ctx.path === "/oauth2/update-client" ||
        ctx.path === "/admin/oauth2/update-client"
      ) {
        return beforeUpdateClientKeepSector(ctx);
      }
      if (ctx.path === "/magic-link/verify") {
        return beforeMagicLinkProtectCredentials(ctx);
      }
      if (ctx.path === "/oauth2/bc-authorize") {
        await readRepeatedFormResources(ctx);
        if (ctx.body) {
          pinPaymentRequest(ctx.body);
          pinPurchaseRequest(ctx.body);
          normalizeUserTokenResources(ctx.body, { allowWalletAudience: true });
          await refuseUnverifiedAgentAssertion(ctx, ctx.body);
        }
        return;
      }
      if (ctx.path === "/oauth2/authorize-challenge") {
        await deleteExpiredFirstPartyRows().catch((error: unknown) =>
          logError(error, { operation: "first-party-row-cleanup" })
        );
        await readRepeatedFormResources(ctx);
        if (ctx.body) {
          normalizeUserTokenResources(ctx.body, { allowWalletAudience: false });
        }
        return;
      }
      if (ctx.path === "/oauth2/token") {
        // Before any hook stages state for the grant, so the client's retry
        // with the nonce redeems the same grant (RFC 9449 §8).
        await oauthProviderApi(ctx).challengeDpopNonce();
        await readRepeatedFormResources(ctx);
        const isCibaGrant = ctx.body?.grant_type === CIBA_GRANT_TYPE;
        // Only a CIBA payment approval yields a wallet-audience token. The
        // per-grant checks below do not see every grant (client_credentials
        // and the pre-authorized code grant skip resource normalization), so
        // the refusal covers them all here.
        if (!isCibaGrant) {
          refuseWalletAudience(ctx.body?.resource, ctx.body?.audience);
        }
        if (isCibaGrant) {
          await beforeCibaTokenLoadRequest(ctx);
        }
        beforeTokenValidateResource(ctx);
        if (USER_TOKEN_GRANT_TYPES.has(ctx.body?.grant_type)) {
          normalizeUserTokenResources(ctx.body, {
            allowWalletAudience: isCibaGrant,
          });
        }
        await beforeTokenFinalizeDisclosureBindings(ctx);
        return;
      }
      if (ctx.path === "/oauth2/consent") {
        rejectCibaInteraction(ctx);
        return beforeConsentStripIdentityScopes(ctx);
      }
      if (ctx.path === "/oauth2/continue") {
        return rejectCibaInteraction(ctx);
      }
      if (ctx.path === "/oauth2/par") {
        if (!ctx.body?.resource) {
          throw new APIError("BAD_REQUEST", {
            error: "invalid_request",
            error_description:
              "resource parameter is required for PAR requests",
          });
        }
        await readRepeatedFormResources(ctx);
        refuseWalletAudience(ctx.body.resource);
        beforeValidateResourceUri(ctx);
        normalizeUserTokenResources(ctx.body, { allowWalletAudience: false });
        return;
      }
      if (ctx.path === "/oauth2/authorize") {
        const request = authorizeRequestParameters(ctx);
        if (request === ctx.body) {
          await readRepeatedFormResources(ctx);
        }
        redirectCibaInteraction(ctx, request);
        await enforceAuthorizeAcr(ctx, db);
        await beforeAuthorizeVerifyConsentHmac(ctx, request);
        normalizeUserTokenResources(request, { allowWalletAudience: false });
        return;
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      await afterPersistAuthenticationContext(ctx);
      if (ctx.path === "/oauth2/consent") {
        await afterConsentPairwiseCleanup(ctx);
        return;
      }
      if (ctx.path === "/oauth2/par") {
        await afterParRememberAcr(ctx);
        return;
      }
      if (ctx.path === "/oauth2/token") {
        await afterCibaTokenPersist(ctx);
        return;
      }
      if (ctx.path === "/oauth2/introspect") {
        return afterIntrospectKeepJwtSubject(ctx);
      }
      if (ctx.path === "/oauth2/create-client") {
        await afterCreateClientMakePairwise(ctx);
      }
      return;
    }),
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    opaque({
      serverSetup: () => env.OPAQUE_SERVER_SETUP,
      // Records how each password was set, and keeps a reset by email from
      // adding a password to a passkey account (`recovery-factors.ts`).
      authorizePasswordChange,
      sendResetPassword: async ({ user, url }) => {
        const { sendResetPasswordEmail } = await import("@/lib/email/auth");
        await sendResetPasswordEmail({ user, url });
      },
      onPasswordReset: async ({ user }) => {
        await detachVaultCredential(user.id, OPAQUE_CREDENTIAL_ID);
        await notifyRecoveryFactorChange({
          notice: "password_reset",
          userId: user.id,
        });
      },
      revokeSessionsOnPasswordReset: true,
    }),
    anonymous({
      emailDomainName: ANONYMOUS_EMAIL_DOMAIN,
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { sendMagicLinkEmail } = await import("@/lib/email/auth");
        await sendMagicLinkEmail({ email, url });
      },
      expiresIn: 300, // 5 minutes
    }),
    passkey({
      rpID: PASSKEY_RP_ID,
      origin: getTrustedOrigins(),
      // Authenticators without user verification are accepted; the session
      // states what the ceremony observed.
      authentication: {
        afterVerification: ({ verification }) =>
          passkeyUserVerified.set(verification.authenticationInfo.userVerified),
      },
      // A passkey on an account that holds one needs a recent user-verified
      // passkey sign-in or an account recovery (`recovery-factors.ts`).
      registration: {
        afterVerification: async ({ ctx, verification }) => {
          const credentialId = verification.registrationInfo?.credential.id;
          if (credentialId) {
            await authorizePasskeyEnrollment(ctx, credentialId);
          }
        },
      },
    }),
    organization({
      creatorRole: "owner",
    }),
    siweAuth({ emailDomainName: WALLET_EMAIL_DOMAIN }),
    recoveryFactorsPlugin(),
    jwt({
      ...signingKeyOptions,
      jwks: {
        ...signingKeyOptions.jwks,
        // The plugin requires a remote JWKS URL alongside jwt.sign; Zentity
        // publishes the plugin's keys there itself.
        remoteUrl: joinAuthIssuerPath(authIssuer, "oauth2/jwks"),
      },
      jwt: {
        issuer: authIssuer,
        // signJwt signs with the plugin's keys and adds what the provider
        // cannot: EdDSA access tokens whose subject is pairwise for their
        // audience (U4 in docs/adr/platform/0002-better-auth-patches.md).
        sign: signJwt,
      },
    }),
    oauthProvider({
      accessTokenExpiresIn: 3600,
      // `/oauth2/revoke` revokes JWT access tokens, and revoking a refresh
      // token revokes the JWT access tokens of its grant. Introspection,
      // UserInfo, and Zentity's resources then refuse them; the wallet
      // runtime learns of them from the revocation feed.
      revocableJwtAccessTokens: true,
      // ES256 is the only proof algorithm Zentity clients present. Every DPoP
      // proof sent to this origin must carry a nonce this server issued in the
      // last 300 seconds (RFC 9449 §8, §9). Zentity's own DPoP endpoints verify
      // proofs with these settings, so one nonce serves the whole origin.
      dpop: {
        signingAlgorithms: ["ES256"],
        nonce: { required: true, expiresIn: 300 },
      },
      // Optional at the provider: remote MCP hosts authorize without PAR.
      pushedAuthorizationRequests: { enabled: true, expiresIn: 60 },
      // `next build` skips env validation but still builds this config, and
      // the provider refuses pairwise subjects without a secret. The build
      // never issues tokens, so a placeholder there is safe; env.ts requires
      // the real secret at runtime.
      pairwiseSecret:
        env.PAIRWISE_SECRET ??
        (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
          ? "next-build-placeholder-pairwise-secret"
          : undefined),
      // A pairwise client's JWT access tokens get a pairwise `sub`, which
      // signJwt scopes to the token's audience, and the provider adds the
      // user id encrypted in `ba_sub`, which UserInfo, introspection, and
      // every `validateAccessToken` caller read back.
      accessTokenSubject: "pairwise",
      scopes: [...OAUTH_SCOPES],
      grantTypes: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "urn:openid:params:grant-type:ciba",
      ],
      // Protected resources the AS issues tokens for (RFC 8707). Per-client
      // resource linkage is disabled: Zentity has dynamic DCR/wallet clients
      // that implicitly may target any enabled resource. The wallet resource
      // carries the 120 s payment token lifetime; "merge" applies it to a row
      // seeded before it existed.
      resourceSeedMode: "merge",
      resources: getProtectedResourceAudiences({
        appUrl,
        authIssuer,
        mcpPublicUrl: env.MCP_PUBLIC_URL,
        oidc4vciCredentialAudience,
        rpApiAudience,
        walletAudience: env.WALLET_AUDIENCE,
      }),
      enforcePerClientResources: false,
      // Registered ahead of every plugin's extension, so Zentity's discovery
      // fields win the provider's first-wins merge.
      extensions: [discoveryMetadataExtension, clientMetadataExtension],
      // Enable RFC 7591 Dynamic Client Registration for OIDC4VCI wallets
      // Wallets can self-register via POST /api/auth/oauth/register
      allowDynamicClientRegistration: true,
      // Allow public clients (no client_secret) - required for mobile/browser wallets
      allowUnauthenticatedClientRegistration: true,
      // A dynamically registered client with post-logout redirects is asking
      // for RP-initiated logout. Enabling it makes the provider refuse any
      // redirect outside the client's origins, which would stop a metadata
      // document client from authorizing at all, so only `/oauth2/register`
      // opts in.
      clientRegistrationEnableEndSession: ({ client, registrationSource }) =>
        registrationSource === "dynamic" &&
        (client.post_logout_redirect_uris?.length ?? 0) > 0,
      clientRegistrationDefaultScopes: defaultClientScopes,
      clientRegistrationAllowedScopes: allowedClientScopes,
      clientReference: ({ session }) =>
        typeof session?.activeOrganizationId === "string"
          ? session.activeOrganizationId
          : undefined,
      clientPrivileges: ({ action, session, user }) =>
        canManageOAuthClients({
          action,
          organizationId:
            typeof session?.activeOrganizationId === "string"
              ? session.activeOrganizationId
              : null,
          userId: user?.id,
        }),
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      postLogin: {
        page: "/oauth/consent",
        consentReferenceId: ({ query, session, scopes }) =>
          computeConsentReferenceId(getConsentReferenceKey(), {
            clientId: query.get("client_id") ?? "",
            scopes,
            sessionId: session.id,
          }),
        shouldRedirect: () => false,
      },
      advertisedMetadata: {
        claims_supported: advertisedClaims,
      },
      // The ID token `acr` is the user's assurance tier and `amr` the methods
      // of the approving session. Unmet `acr_values` are rejected before this
      // runs (enforceAuthorizeAcr, and the first-party apps policy for the
      // challenge endpoint). CIBA approvals state the same values to
      // completeCibaRequest.
      authenticationContext: {
        acrValuesSupported: [...ACR_VALUES_SUPPORTED],
        resolve: async ({ user, session }) => {
          const [assurance, authentication] = await Promise.all([
            getAccountAssurance(user.id, { isAuthenticated: true }),
            getAuthenticationStateBySessionId(session.id),
          ]);
          return {
            acr: computeAcr(assurance.tier),
            ...(authentication?.amr.length ? { amr: authentication.amr } : {}),
          };
        },
      },
      // Access-token disclosure claims (sybil/humanity/CIBA snapshot/auth
      // context) come from the exact-disclosure-claims extension's
      // `claims.accessToken` contributor, which receives the resolved `client`
      // and is re-derived at opaque-token introspection.
      customUserInfoClaims: async (info) => {
        const { user, scopes } = info;
        const jwt = (
          info as {
            jwt?: {
              azp?: string;
              client_id?: string;
              jti?: string;
              [RELEASE_BINDING_CLAIM]?: string;
            };
          }
        ).jwt;
        const clientId = jwt?.azp ?? jwt?.client_id;
        // Indexes the subject this client receives so it can name the user back.
        if (clientId) {
          await resolveSubForClientId(user.id, clientId);
        }
        // Release-bound tokens carry the binding as RELEASE_BINDING_CLAIM: JWT
        // access tokens on the wire, opaque tokens via their introspection
        // re-derive.
        const releaseCandidate =
          typeof jwt?.[RELEASE_BINDING_CLAIM] === "string"
            ? jwt[RELEASE_BINDING_CLAIM]
            : undefined;
        const releaseId =
          releaseCandidate && (await hasReleaseContext(releaseCandidate))
            ? releaseCandidate
            : undefined;
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
            throw userInfoReleaseError("release_context_client_missing");
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
              throw userInfoReleaseError(error.reason);
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
            throw userInfoReleaseError("identity_payload_missing");
          }
          if (
            payload.meta.clientId !== clientId ||
            (releaseContext.scopeHash &&
              payload.meta.scopeHash !== releaseContext.scopeHash)
          ) {
            throw userInfoReleaseError("identity_payload_mismatch");
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
    // Client ID Metadata Documents (MCP CIMD). The plugin owns fetching,
    // validation, caching, and persistence through clientDiscovery; the
    // provider enforces each discovered client's registered grants.
    cimd(cimdOptions),
    exactDisclosureClaimsPlugin(),
    verifiedClaimsPlugin(),
    oidc4vci({
      defaultWalletClientId: BUILT_IN_WALLET_CLIENT_ID,
      credentialIssuer: authIssuer,
      issuerBaseURL: authIssuer,
      credentialAudience: oidc4vciCredentialAudience,
      authorizationServer: authIssuer,
      credentialConfigurations: oidc4vciCredentialConfigurations,
      // The credential endpoints require DPoP-bound tokens and ES256 proofs
      // through the haip plugin's defaults.
      ...(trustedWalletIssuers
        ? {
            proofValidators: {
              attestation: createKeyAttestationValidator({
                trustedIssuers: trustedWalletIssuers,
              }),
            },
          }
        : {}),
      ...(x5cChain
        ? { resolveCredentialHeaders: createX5cHeaders(x5cChain) }
        : {}),
      resolveClaims: async ({ user }: { user: { id: string } }) =>
        buildCredentialClaims(user.id),
      ...(oidc4vciDeferredIssuance
        ? { deferredIssuance: oidc4vciDeferredIssuance }
        : {}),
    }),
    oidc4vp({
      expectedAudience: authIssuer,
      allowedIssuers: [authIssuer],
      // Responses are checked against the VP session their `state` names.
      resolveAuthorizationRequest: createVpSessionResolver(),
      presentationMatcher: createDcqlMatcher(),
      responseModeHandlers: {
        "direct_post.jwt": createJarmHandler({
          decryptionKey: getJarmDecryptionKey,
          supportedAlgs: ["ECDH-ES"],
          supportedEnc: ["A128GCM", "A256GCM"],
        }),
      },
      // allowedIssuers admits only this issuer, so credentials verify against
      // its published keys. Status list tokens reach the resolver without the
      // allowedIssuers check, so their `iss` never chooses a URL to fetch.
      resolveIssuerJwks: async () => {
        if (!env.OIDC4VP_JWKS_URL) {
          return (await getPublishedJwks()).keys;
        }
        const response = await fetch(env.OIDC4VP_JWKS_URL, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw new Error("Unable to resolve issuer JWKS");
        }
        const body = (await response.json()) as { keys?: unknown };
        return Array.isArray(body.keys)
          ? (body.keys as Record<string, unknown>[])
          : [];
      },
      verifyStatusList: true,
      // The status list token is minted after the verifier snapshots the clock.
      clockSkewSeconds: 30,
      requiredClaimKeys: ["verification_level", "verified"],
    }),
    haip({
      vpRequestExpiresInSeconds: 300,
      ...(trustedWalletIssuers
        ? { walletAttestation: { trustedIssuers: trustedWalletIssuers } }
        : {}),
    }),
    ciba({
      // Zentity sends users to its own approval page, never the provider's
      // consent page (see redirectCibaInteraction), so this is a fallback.
      resultPage: "/dashboard/agents",
      deliveryModes: ["poll", "ping"],
      expiresIn: 300,
      interval: 5,
      // Agents register via DCR as public clients (token_endpoint_auth_method:
      // "none"); backchannel trust comes from user approval and the signed
      // Agent-Assertion, and their tokens are DPoP-bound.
      allowPublicClients: true,
      // A client names the user only by the subject identifier it received
      // from Zentity, so an unknown hint reveals nothing the client did not
      // already hold and no client can prompt arbitrary accounts.
      async resolveUser({ loginHint, client }, ctx) {
        const userId = await resolveUserIdFromSub(loginHint, client.clientId);
        return userId
          ? await ctx.context.internalAdapter.findUserById(userId)
          : null;
      },
      sendNotification: notifyCibaRequest,
      authorizationDetailsTypes: cibaAuthorizationDetailsTypes,
    }),
    cibaApprovalPlugin(cibaApproval),
    tokenExchangePlugin(),
    resourceAccessTokenPlugin(),
    firstPartyAppsPlugin(),
    // Must stay last: forwards Set-Cookie from every prior plugin's after-hook.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
