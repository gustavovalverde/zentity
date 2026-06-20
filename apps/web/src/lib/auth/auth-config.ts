import type { AuthContext } from "@better-auth/core";
import type { AapAccessTokenClaims } from "@zentity/sdk/protocol";
import type { LoginMethod } from "@/lib/assurance/types";
import type { OpaqueEndpointContext } from "@/lib/auth/opaque/types";

import { createHash } from "node:crypto";

import { ciba, deliverPing } from "@better-auth/ciba";
import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  createDpopAccessTokenValidator,
  createJarmHandler,
  createKeyAttestationValidator,
  createParResolver,
  createX5cHeaders,
  haip,
} from "@better-auth/haip";
import {
  extendOAuthProvider,
  type OAuthClaimExtensionInput,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { oidc4ida } from "@better-auth/oidc4ida";
import { type Oidc4vciOptions, oidc4vci } from "@better-auth/oidc4vci";
import { oidc4vp } from "@better-auth/oidc4vp";
import { passkey } from "@better-auth/passkey";
import { decodeJwtPayloadStrict } from "@zentity/sdk/protocol";
import { APIError, type BetterAuthPlugin, betterAuth } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import {
  admin,
  anonymous,
  jwt,
  magicLink,
  twoFactor,
} from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

import { env } from "@/env";
import { evaluateSessionGrants } from "@/lib/agents/approval-evaluate";
import {
  deriveCapabilityName,
  normalizeAuthorizationDetails,
} from "@/lib/agents/capability";
import { buildCibaPushPayload, sendWebPush } from "@/lib/agents/push-sender";
import {
  AGENT_BOOTSTRAP_SCOPES,
  bindAgentAssertionToCibaRequest,
} from "@/lib/agents/session";
import {
  buildCibaAgentContribution,
  persistTokenSnapshot,
  type StoredTokenSnapshot,
} from "@/lib/agents/token-snapshot";
import { buildNamespacedAssuranceClaim } from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import { reportRejection } from "@/lib/async-handler";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  createSessionAuthenticationContext,
  getAuthenticationStateBySessionId,
  resolveAuthenticationContext,
} from "@/lib/auth/auth-context";
import { eip712Auth } from "@/lib/auth/eip712/server";
import {
  revokePendingCibaOnLogout,
  sendBackchannelLogout,
} from "@/lib/auth/oidc/backchannel-logout";
import {
  hashCibaAuthReqId,
  rawAuthReqIdFromApprovalUrl,
} from "@/lib/auth/oidc/ciba-auth-req";
import {
  persistDcrClientExtensions,
  readDcrClientExtensions,
} from "@/lib/auth/oidc/dcr-client-extensions";
import {
  buildOidcVerifiedClaims,
  buildProofClaims,
  computeConsentHmac,
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
  type ReleaseContext,
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
import { getDpopNonceStore } from "@/lib/auth/oidc/haip/dpop";
import { getJarmDecryptionKey } from "@/lib/auth/oidc/haip/jarm-key";
import { getProtectedResourceAudiences } from "@/lib/auth/oidc/haip/resource-metadata";
import { createTrustedDcqlMatcher } from "@/lib/auth/oidc/haip/trusted-dcql-matcher";
import {
  loadX5cChain,
  validateX509Chain,
} from "@/lib/auth/oidc/haip/x509-validation";
import { getJwtSigningKeys, signJwt } from "@/lib/auth/oidc/jwt-signer";
import { validateResourceUri } from "@/lib/auth/oidc/oauth-request";
import { deletePairwiseSubjectsForUser } from "@/lib/auth/oidc/pairwise-subject-index";
import {
  buildPaymentAuthorizationClaims,
  canonicalizePaymentRar,
  PAYMENT_AUTHORIZATION_SCOPE,
  PAYMENT_TOKEN_SCOPE_EXPIRATIONS,
  pinPaymentTokenAudience,
} from "@/lib/auth/oidc/payment-mint";
import {
  enforceCibaApprovalAcr,
  enforceCibaTokenAcr,
  enforceStepUp,
} from "@/lib/auth/oidc/step-up";
import { resolveSybilNullifier } from "@/lib/auth/oidc/sybil";
import { tokenExchangePlugin } from "@/lib/auth/oidc/token-exchange";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/oidc/well-known";
import { opaque } from "@/lib/auth/opaque/server";
import { getTrustedOrigins } from "@/lib/auth/origin";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { getActiveHumanityCredentials } from "@/lib/db/queries/humanity";
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
import {
  haipPushedRequests,
  haipVpSessions,
  jwks,
  oauthAccessTokens,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
} from "@/lib/db/schema/oauth-provider";
import {
  oidc4idaVerifiedClaims,
  oidc4vciIssuedCredentials,
  oidc4vciOffers,
} from "@/lib/db/schema/oidc-credentials";
import {
  invitations,
  members,
  organizations,
} from "@/lib/db/schema/organization";
import { RECOVERY_GUARDIAN_TYPE_TWO_FACTOR } from "@/lib/db/schema/recovery";
import { sendCibaNotification } from "@/lib/email/ciba";
import { validateSafeUrl } from "@/lib/http/url-safety";
import { resolveRpUniqueHumanityClaim } from "@/lib/identity/humanity/nullifier";
import { logger as rootLogger } from "@/lib/logging/logger";
import { getConsentHmacKey } from "@/lib/privacy/primitives/derived-keys";

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
  oauthResource: oauthResources,
  oauthClientResource: oauthClientResources,
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

const cimdLog = rootLogger.child({ component: "cimd" });

// The CIMD plugin persists only the standard OAuth client fields. CIMD clients
// are dynamic and untrusted, so stamp Zentity's posture columns: a pairwise
// subject (per-RP privacy), the discovery trust tier, and the metadata
// source/timestamp for audit and staleness.
async function applyCimdClientPosture(clientId: string) {
  await db
    .update(oauthClients)
    .set({
      metadataUrl: clientId,
      metadataFetchedAt: new Date(),
      trustLevel: 1,
      subjectType: "pairwise",
    })
    .where(eq(oauthClients.clientId, clientId))
    .run();
}

const cimdOptions = {
  onClientCreated: async ({ client }: { client: { clientId: string } }) => {
    await applyCimdClientPosture(client.clientId);
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
    await applyCimdClientPosture(client.clientId);
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
  "email",
  "proof:humanity",
  "proof:humanity:rp_unique",
  "poh",
  "offline_access",
  ...AGENT_BOOTSTRAP_SCOPES,
  PAYMENT_AUTHORIZATION_SCOPE,
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
// Best-effort ping retries when auto-approving a registered agent's CIBA request.
const CIBA_PING_MAX_RETRIES = 3;
const HTML_TAG_RE = /<[^>]+>/;
const PROTECTED_RESOURCE_METADATA_FIELD = "zentity_protected_resource";
const isDev = process.env.NODE_ENV !== "production";

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

// Native DPoP (oauth-provider 1.7) owns the token endpoint's sender-constraint
// binding. The credential endpoint (oidc4vci) still validates DPoP through this
// HAIP validator, wrapped here to enforce server-managed nonces (RFC 9449 §8).
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

// HAIP wallet attestation trust anchors (HAIP §4.4.1.6). Passed to the haip
// plugin, which now owns the wallet-attestation client-authentication strategy.
const trustedWalletIssuers = env.TRUSTED_WALLET_ISSUERS
  ? env.TRUSTED_WALLET_ISSUERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

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

  let rpValidityNoticeUri: string | undefined;
  if (typeof body.rp_validity_notice_uri === "string") {
    rpValidityNoticeUri = body.rp_validity_notice_uri.trim();
  }
  if (rpValidityNoticeUri && !isDev && !isValidHttpsUrl(rpValidityNoticeUri)) {
    throw new APIError("BAD_REQUEST", {
      error_description: "rp_validity_notice_uri must be an HTTPS URL",
    });
  }

  const protectedResource =
    typeof body[PROTECTED_RESOURCE_METADATA_FIELD] === "string"
      ? body[PROTECTED_RESOURCE_METADATA_FIELD]
      : undefined;
  if (protectedResource) {
    const result = validateResourceUri(protectedResource);
    if (!result.valid) {
      throw new APIError("BAD_REQUEST", {
        error_description: `${PROTECTED_RESOURCE_METADATA_FIELD}: ${result.error}`,
      });
    }
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

function accessTokenJti(token: string): string | undefined {
  if (token.split(".").length !== 3) {
    return undefined;
  }
  try {
    const jti = decodeJwt(token).jti;
    return typeof jti === "string" ? jti : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pre-loads the agent context for a CIBA poll/token request before the plugin
 * consumes (deletes) the ciba_request row. The better-auth adapter returns only
 * the plugin's declared columns to the grant handler, and the row is gone by the
 * time the claim contributors run, so the agent columns (session, attestation,
 * approved capability) and approval-time auth context are read here via Drizzle
 * while the row still exists, then stashed for the claim hook and after-hook.
 */
async function beforeCibaTokenLoadAgent(ctx: HookCtx) {
  const rawAuthReqId = ctx.body?.auth_req_id as string | undefined;
  if (!rawAuthReqId) {
    return;
  }
  const authReqIdHash = hashCibaAuthReqId(rawAuthReqId);
  const row = await db
    .select()
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqIdHash))
    .limit(1)
    .get();
  if (!row) {
    return;
  }
  const audienceClientId =
    (ctx.body?.client_id as string | undefined) ?? row.clientId;
  const contribution = await buildCibaAgentContribution(
    row as unknown as Record<string, unknown>,
    audienceClientId
  );
  pendingCibaToken.set(authReqIdHash, {
    authContextId: row.authContextId ?? "",
    snapshot: contribution?.snapshot ?? null,
    claims: contribution?.claims ?? null,
  });
}

/**
 * Drains the CIBA token stash after `/oauth2/token`: writes the approval-time
 * authentication context onto the issued access/refresh records (Zentity
 * extension columns the upstream issuance does not set) and persists the agent
 * snapshot keyed by the minted token's identity. The request carries the raw
 * auth_req_id; the plugin stores its hash, so the token records and stash are
 * keyed on the hash. The snapshot is keyed by the JWT's jti (the AS owns it) or,
 * for opaque tokens, by the referenceId (the same hash) introspection looks up.
 */
async function afterCibaTokenPersist(ctx: HookCtx) {
  const rawAuthReqId = ctx.body?.auth_req_id as string | undefined;
  if (!rawAuthReqId) {
    return;
  }
  const authReqIdHash = hashCibaAuthReqId(rawAuthReqId);
  const pending = pendingCibaToken.get(authReqIdHash);
  pendingCibaToken.delete(authReqIdHash);
  if (!pending) {
    return;
  }

  if (pending.authContextId) {
    await Promise.all([
      db
        .update(oauthAccessTokens)
        .set({ authContextId: pending.authContextId })
        .where(eq(oauthAccessTokens.referenceId, authReqIdHash))
        .run(),
      db
        .update(oauthRefreshTokens)
        .set({ authContextId: pending.authContextId })
        .where(eq(oauthRefreshTokens.referenceId, authReqIdHash))
        .run(),
    ]);
  }

  const audienceClientId = ctx.body?.client_id as string | undefined;
  if (pending.snapshot && audienceClientId) {
    const responseBody = await readReturnedResponseBody(
      (ctx.context as { returned?: unknown }).returned
    );
    const accessToken = responseBody?.access_token;
    const tokenJti =
      typeof accessToken === "string"
        ? (accessTokenJti(accessToken) ?? authReqIdHash)
        : authReqIdHash;
    await persistTokenSnapshot({
      tokenJti,
      audienceClientId,
      snapshot: pending.snapshot,
    });
  }
}

async function afterDcrRegisterPersistExtensions(ctx: HookCtx) {
  const extensions = readDcrClientExtensions(
    ctx.body as Record<string, unknown> | undefined
  );
  if (!extensions) {
    return;
  }

  const returned = (ctx.context as { returned?: unknown }).returned;
  const responseBody = await readReturnedResponseBody(returned);
  if (!responseBody) {
    return;
  }

  const clientId = responseBody.client_id;
  if (typeof clientId === "string") {
    await persistDcrClientExtensions(clientId, extensions);
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

// The CIBA request row is consumed (deleted) before the token claims run, so
// buildAccessTokenClaims stashes its approval-time authentication context and
// agent snapshot here (keyed by the hashed auth_req_id) while the row still
// exists. The claim contributors read the auth context within the same issuance;
// the /oauth2/token after-hook then drains it onto the persisted token records
// and writes the agent snapshot keyed by the minted token's jti. CIBA is
// decoupled, so the id_token must reflect the captured approval-time context,
// not the user's latest one.
interface PendingCibaToken {
  authContextId: string; // "" when the approved request carried no auth context
  claims: AapAccessTokenClaims | null; // embedded agent AAP claims, if any
  snapshot: StoredTokenSnapshot | null; // set only for verified agent sessions
}
const pendingCibaToken = new Map<string, PendingCibaToken>();

// Off-wire binding from an opaque access token's introspection re-derive to its
// release context. The AS-owned jti no longer equals the release id, so userinfo
// resolves the staged identity payload through this claim (opaque tokens only;
// it never appears on a minted JWT).
const RELEASE_BINDING_CLAIM = "zentity_release_binding";

async function buildIdTokenDisclosureClaims(input: {
  authContextId?: string | null;
  referenceId?: string;
  scopes: unknown;
  sessionId?: string | null;
  user: { id: string };
}): Promise<Record<string, unknown>> {
  const scopeList = toScopeList(input.scopes);
  const cibaAuthContextId = input.referenceId
    ? pendingCibaToken.get(input.referenceId)?.authContextId
    : undefined;
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
      ...buildNamespacedAssuranceClaim(assurance, resolvedAuth),
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

  // The claims-request parameter filters the standard/proof claims it can name.
  // The namespaced zentity_assurance and auth-context claims are always included
  // when they apply, like any zentity-owned claim a client cannot opt out of.
  return {
    ...filterClaimsByRequest(proofClaims, idTokenFilter),
    ...assuranceClaims,
    ...authContextClaims,
  };
}

async function buildAccessTokenDisclosureClaims(
  info: OAuthClaimExtensionInput
): Promise<Record<string, unknown>> {
  const userId = info.user?.id;
  if (!userId) {
    return {};
  }
  const clientId = info.client?.clientId;
  const referenceId = info.referenceId;
  const sessionId = info.sessionId;
  const scopeList = toScopeList(info.scopes);
  const claims: Record<string, unknown> = {};
  // Non-empty when this is a CIBA-issued token whose approval captured an
  // authentication context. Agent AAP claims are not added here: the AS strips
  // reserved claims and re-derives this contributor on opaque introspection, so
  // the embedded agent claims come from the grant handler's per-issuance claims
  // (JWT) and the durable snapshot keyed by the token jti (opaque introspection).
  const cibaAuthContextId = referenceId
    ? pendingCibaToken.get(referenceId)?.authContextId
    : undefined;

  // Per-RP sybil nullifier
  if (scopeList.includes("proof:sybil") && clientId) {
    const nullifier = await resolveSybilNullifier(userId, clientId);
    if (nullifier) {
      claims.sybil_nullifier = nullifier;
    }
  }

  if (scopeList.includes("proof:humanity:rp_unique") && clientId) {
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

  if (cibaAuthContextId) {
    claims[AUTHENTICATION_CONTEXT_CLAIM] = cibaAuthContextId;
  }

  // Extend the identity-payload TTL whenever a token is minted for a
  // release-bound request so the payload survives until userinfo consumes it.
  if (referenceId) {
    const releaseContext = await loadReleaseContext(referenceId);
    if (releaseContext) {
      await touchReleaseContext(
        releaseContext.releaseId,
        Date.now() + 3600 * 1000
      );
      // On the opaque-token introspection re-derive (grantType is absent here
      // but set at JWT mint), surface the release binding so userinfo can locate
      // the staged identity payload. It never reaches the wire: opaque tokens
      // carry no claims, and the JWT mint path skips this branch.
      if (info.grantType === undefined) {
        claims[RELEASE_BINDING_CLAIM] = referenceId;
      }
    }
  }

  // sessionId-bound authentication context is only added when there is no
  // session (CIBA / opaque introspection); the session-bound path derives it
  // from the session directly.
  if (!(sessionId || claims[AUTHENTICATION_CONTEXT_CLAIM]) && referenceId) {
    const refreshRow = await db
      .select({ authContextId: oauthRefreshTokens.authContextId })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.referenceId, referenceId))
      .limit(1)
      .get();
    if (refreshRow?.authContextId) {
      claims[AUTHENTICATION_CONTEXT_CLAIM] = refreshRow.authContextId;
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
          idToken: (info: OAuthClaimExtensionInput) => {
            if (!info.user?.id) {
              return {};
            }
            // sessionId is present on the plain authorization_code path; it is
            // undefined for client_credentials / opaque introspection, where
            // the authentication context falls back to referenceId/userId.
            return buildIdTokenDisclosureClaims({
              authContextId: null,
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
  const result = validateResourceUri(ctx.body?.resource);
  if (!result.valid) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: result.error,
    });
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
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
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
      const { sendEmailVerification } = await import("@/lib/email/auth");
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
      if (ctx.path === "/oauth2/bc-authorize") {
        const canonical = canonicalizePaymentRar(
          ctx.body?.authorization_details
        );
        if (canonical && ctx.body) {
          ctx.body.authorization_details = canonical;
        }
        return;
      }
      if (ctx.path === "/oauth2/token") {
        await beforeTokenPairwiseGuard(ctx);
        // Pin aud=wallet identity URI for a payment grant AFTER the pairwise
        // guard, which would otherwise strip the resource for pairwise agents.
        if (ctx.body) {
          await pinPaymentTokenAudience(ctx.body);
        }
        if (ctx.body?.grant_type === "urn:openid:params:grant-type:ciba") {
          await enforceCibaTokenAcr(ctx, db);
          await beforeCibaTokenLoadAgent(ctx);
        }
        beforeTokenValidateResource(ctx);
        await beforeTokenFinalizeDisclosureBindings(ctx);
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
        return;
      }
      if (ctx.path === "/oauth2/authorize") {
        if (!ctx.query?.resource) {
          ctx.query = { ...ctx.query, resource: appUrl };
        }
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
      if (ctx.path === "/oauth2/register") {
        await afterDcrRegisterPersistExtensions(ctx);
        return;
      }
      if (ctx.path === "/oauth2/consent") {
        await afterConsentPairwiseCleanup(ctx);
        return;
      }
      if (ctx.path === "/oauth2/par") {
        await afterParPersistResource(ctx);
        return;
      }
      if (ctx.path === "/oauth2/token") {
        await afterCibaTokenPersist(ctx);
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
          ).catch(reportRejection);
          revokePendingCibaOnLogout(userId).catch(reportRejection);
        }
      }
    }),
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    opaque({
      serverSetup: () => env.OPAQUE_SERVER_SETUP,
      resolveUserByIdentifier: resolveOpaqueUserByIdentifier,
      sendResetPassword: async ({ user, url }) => {
        const { sendResetPasswordEmail } = await import("@/lib/email/auth");
        await sendResetPasswordEmail({ user, url });
      },
      revokeSessionsOnPasswordReset: true,
    }),
    anonymous({
      emailDomainName: "anon.zentity.app",
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { sendMagicLinkEmail } = await import("@/lib/email/auth");
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
      accessTokenExpiresIn: 3600,
      // Payment tokens live 120s (D-6); every other scope keeps the 3600s
      // default. Token issuance takes the minimum across the granted scopes.
      scopeExpirations: PAYMENT_TOKEN_SCOPE_EXPIRATIONS,
      // Native DPoP (RFC 9449) owns the token endpoint in 1.7. ES256 is the only
      // proof algorithm Zentity wallets present.
      dpop: { signingAlgorithms: ["ES256"] },
      requestUriResolver: createParResolver(),
      pairwiseSecret: env.PAIRWISE_SECRET,
      scopes: [...OAUTH_SCOPES, PAYMENT_AUTHORIZATION_SCOPE],
      grantTypes: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "urn:openid:params:grant-type:ciba",
      ],
      // Protected resources the AS issues tokens for (RFC 8707). Per-client
      // resource linkage is disabled: Zentity has dynamic DCR/wallet clients
      // that implicitly may target any enabled resource.
      resources: getProtectedResourceAudiences({
        appUrl,
        authIssuer,
        mcpPublicUrl: env.MCP_PUBLIC_URL,
        oidc4vciCredentialAudience,
        rpApiAudience,
        walletAudience: env.WALLET_AUDIENCE,
      }),
      enforcePerClientResources: false,
      // First-party-app step-up: when the authorization code was issued from a
      // DPoP-bound auth_session (authorize-challenge route), echo it back so the
      // FPA client can re-authenticate on a later acr step-up failure.
      customTokenResponseFields: ({ grantType, verificationValue }) => {
        const authSession = (
          verificationValue as Record<string, unknown> | undefined
        )?.authSession;
        return grantType === "authorization_code" &&
          typeof authSession === "string"
          ? { auth_session: authSession }
          : {};
      },
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
      // id_token `acr`/`amr`/`auth_time` are AS-owned in 1.7 (the provider
      // reports acr: "0" until it supports requestable ACR classes). The
      // assurance tier rides in the namespaced zentity_assurance claim instead,
      // emitted by the exact-disclosure-claims id-token contributor.
      // Access-token disclosure claims (sybil/humanity/CIBA snapshot/auth
      // context) moved to the exact-disclosure-claims extension's
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
        // Opaque tokens surface the release binding (their re-derive injects it);
        // JWT access tokens, when release-bound, carry the binding as their jti.
        const releaseCandidate =
          (typeof jwt?.[RELEASE_BINDING_CLAIM] === "string"
            ? jwt[RELEASE_BINDING_CLAIM]
            : undefined) ??
          (typeof jwt?.jti === "string" ? jwt.jti : undefined);
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
    // Client ID Metadata Documents (MCP CIMD). The native plugin owns the
    // fetch/validate/cache/persist path through clientDiscovery; SSRF defenses
    // are a superset of the previous hand-rolled validator. CIMD clients are
    // restricted to authorization_code + refresh_token by the plugin.
    cimd(cimdOptions),
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
      parExpiresInSeconds: 60,
      vpRequestExpiresInSeconds: 300,
      ...(trustedWalletIssuers
        ? { walletAttestation: { trustedIssuers: trustedWalletIssuers } }
        : {}),
    }),
    ciba({
      approvalPage: "/approve",
      deliveryModes: ["poll", "ping"],
      requestExpiry: 300,
      pollingInterval: 5,
      // Agents register via DCR as public clients (token_endpoint_auth_method:
      // "none"); backchannel trust comes from user approval and the signed
      // Agent-Assertion, not a client secret. The plugin defaults to
      // confidential-only, which would reject every agent at bc-authorize.
      requireConfidentialClient: false,
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
        // The consumed row the plugin passes here carries only the plugin's
        // declared columns, so the agent AAP claims were resolved in the
        // /oauth2/token before-hook (while the full row still existed) and
        // stashed; embed them here. The after-hook drains the rest of the stash.
        const pending = pendingCibaToken.get(cibaRequest.authReqId);

        const releaseContext = await loadReleaseContext(cibaRequest.authReqId);
        if (
          releaseContext?.expectsIdentityPayload &&
          !hasIdentityPayload(finalReleaseIdentityKey(cibaRequest.authReqId))
        ) {
          throw invalidGrantDisclosureError("identity_payload_missing");
        }
        if (releaseContext) {
          await touchReleaseContext(
            cibaRequest.authReqId,
            Date.now() + 3600 * 1000
          );
        }

        // Re-mint the RAR server-side from the persisted (canonical) form and
        // emit it as authorization_details (D-1). A corrupt stored RAR throws,
        // failing the mint loudly rather than minting a token without it. Keep it
        // last so AAP claims can't clobber it.
        const paymentClaims = buildPaymentAuthorizationClaims(
          (cibaRequest as { authorizationDetails?: string | null })
            .authorizationDetails
        );

        return {
          ...(pending?.claims ?? {}),
          ...(paymentClaims ?? {}),
        };
      },
      sendNotification: async (data, request) => {
        // The 1.7 plugin no longer hands the raw auth_req_id directly; it lives
        // in the approvalUrl it built. The raw value is what the approval page
        // and ping delivery consume; its hash keys the persisted ciba_request.
        const rawAuthReqId = rawAuthReqIdFromApprovalUrl(data.approvalUrl);
        if (!rawAuthReqId) {
          throw new Error("CIBA approvalUrl is missing auth_req_id");
        }
        const authReqIdHash = hashCibaAuthReqId(rawAuthReqId);

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
            authReqId: authReqIdHash,
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
            .where(eq(cibaRequests.authReqId, authReqIdHash))
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
                  eq(cibaRequests.authReqId, authReqIdHash),
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
                .where(eq(cibaRequests.authReqId, authReqIdHash))
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
                  rawAuthReqId,
                  CIBA_PING_MAX_RETRIES
                ).catch(() => undefined);
              }
              return;
            }
          }
        }

        const pushPayload = buildCibaPushPayload({
          ...data,
          authReqId: rawAuthReqId,
          agentName,
          requiresBiometric,
        });
        await Promise.allSettled([
          sendWebPush(data.userId, pushPayload),
          sendCibaNotification({
            userId: data.userId,
            authReqId: rawAuthReqId,
            clientName: data.clientName,
            scope: data.scope,
            bindingMessage: data.bindingMessage,
            authorizationDetails: data.authorizationDetails,
            registeredAgent,
            approvalUrl: data.approvalUrl,
          }),
        ]);
      },
    }),
    tokenExchangePlugin(),
    // Must stay last: forwards Set-Cookie from every prior plugin's after-hook.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
