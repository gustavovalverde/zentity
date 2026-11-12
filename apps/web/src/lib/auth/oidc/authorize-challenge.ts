import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPlugin } from "better-auth";

import { createHash, randomBytes } from "node:crypto";

import { ready, server } from "@serenity-kit/opaque";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { and, eq, lt } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";

import { env } from "@/env";
import { computeAcr } from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import {
  createAuthenticationContext,
  getAuthenticationStateBySessionId,
} from "@/lib/auth/auth-context";
import {
  buildDefaultTypedData,
  nonceIdentifier,
  verifyEip712Signature,
} from "@/lib/auth/eip712/typed-data";
import { oauthProviderApi } from "@/lib/auth/oidc/haip/dpop";
import { isZentityHostedResource } from "@/lib/auth/oidc/haip/resource-metadata";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import {
  createDummyRegistrationRecord,
  decryptServerLoginState,
  encryptServerLoginState,
  LOGIN_REQUEST_LENGTH,
  validateBase64Length,
} from "@/lib/auth/opaque/validation";
import { db } from "@/lib/db/connection";
import {
  accounts,
  sessions,
  users,
  verifications,
  walletAddresses,
} from "@/lib/db/schema/auth";
import {
  type AuthChallengeSession,
  authChallengeSessions,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { getOpaqueStateKey } from "@/lib/privacy/primitives/derived-keys";

const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const CODE_LIFETIME_S = 600;
const EIP712_NONCE_TTL_MS = 15 * 60 * 1000;
const EIP712_APP_NAME = "Zentity";
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const SCOPE_SEPARATOR_RE = /\s+/;

// ── Rate limiter (sliding window per IP) ────────────────

import {
  createRealRateLimiter,
  getClientIp,
  rateLimitResponse,
} from "@/lib/http/rate-limit";

export const fpaLimiter = createRealRateLimiter({ windowMs: 60_000, max: 10 });

// ── Request schemas ─────────────────────────────────────

const InitialRequestSchema = z.object({
  chain_id: z.number().int().positive().optional(),
  client_id: z.string().min(1),
  claims: z.string().optional(),
  code_challenge: z.string().min(43).optional(),
  code_challenge_method: z.string().default("S256").optional(),
  identifier: z.string().min(1),
  resource: z.url().optional(),
  response_type: z.literal("code"),
  scope: z.string().min(1),
});

const OpaqueStartSchema = z.object({
  auth_session: z.string().min(1),
  opaque_login_request: z.string().min(1),
});

const OpaqueFinishSchema = z.object({
  auth_session: z.string().min(1),
  opaque_finish_request: z.string().min(1),
});

const Eip712FinishSchema = z.object({
  auth_session: z.string().min(1),
  eip712_signature: z.string().min(1),
});

// ── Helpers ─────────────────────────────────────────────

function errorJson(
  status: number,
  error: string,
  description?: string,
  extra?: Record<string, unknown>
) {
  return Response.json(
    { error, ...(description && { error_description: description }), ...extra },
    { status }
  );
}

/**
 * The thumbprint of the request's verified DPoP proof, which binds the
 * auth_session and the code it yields. The provider refuses a forged, stale,
 * replayed, or mis-targeted proof rather than read it for its key, answers a
 * proof without a current nonce with `use_dpop_nonce` and the nonce to retry
 * with, and hands a verified proof the next nonce (RFC 9449 §8).
 */
async function verifiedDpopJkt(
  ctx: GenericEndpointContext
): Promise<string | undefined> {
  return (await oauthProviderApi(ctx).verifyDpopProof())?.jkt;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

function loadSession(
  authSession: string
): Promise<AuthChallengeSession | undefined> {
  return db
    .select()
    .from(authChallengeSessions)
    .where(eq(authChallengeSessions.authSession, authSession))
    .get();
}

function isExpired(s: AuthChallengeSession): boolean {
  return s.expiresAt.getTime() < Date.now();
}

async function validateChallengeSession(
  authSession: string
): Promise<AuthChallengeSession | Response> {
  const session = await loadSession(authSession);
  if (!session || isExpired(session)) {
    return errorJson(400, "invalid_session", "Session expired or not found");
  }
  if (session.state !== "pending") {
    return errorJson(400, "invalid_session", "Invalid session state");
  }
  return session;
}

async function checkDpopContinuity(
  ctx: GenericEndpointContext,
  session: AuthChallengeSession
): Promise<Response | null> {
  const dpopJkt = await verifiedDpopJkt(ctx);
  if (session.dpopJkt && dpopJkt !== session.dpopJkt) {
    return errorJson(400, "invalid_session", "DPoP key mismatch");
  }
  return null;
}

async function issueEip712Challenge(
  sessionId: string,
  authSession: string,
  wallet: { address: string; chainId: number }
): Promise<Response> {
  const nonce = crypto.randomUUID();
  const nid = nonceIdentifier(wallet.address, wallet.chainId);

  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: nid,
    value: nonce,
    expiresAt: new Date(Date.now() + EIP712_NONCE_TTL_MS),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db
    .update(authChallengeSessions)
    .set({
      opaqueServerState: JSON.stringify({
        walletAddress: wallet.address,
        chainId: wallet.chainId,
        nonce,
        nonceIdentifier: nid,
      }),
    })
    .where(eq(authChallengeSessions.id, sessionId));

  const typedData = buildDefaultTypedData(
    wallet.address,
    wallet.chainId,
    nonce,
    EIP712_APP_NAME
  );

  return Response.json(
    {
      auth_session: authSession,
      challenge_type: "eip712",
      error: "insufficient_authorization",
      nonce,
      typed_data: typedData,
    },
    { status: 401 }
  );
}

// ── Endpoint ────────────────────────────────────────────

/**
 * The First-Party Apps Authorization Challenge Endpoint
 * (`draft-ietf-oauth-first-party-apps`), served under the auth base path so
 * the provider verifies its DPoP proofs and nonces as it does the token
 * endpoint's.
 */
export function authorizeChallengePlugin() {
  return {
    id: "zentity-authorize-challenge",
    endpoints: {
      authorizeChallenge: createAuthEndpoint(
        "/oauth2/authorize-challenge",
        { method: "POST", metadata: { noStore: true } },
        async (ctx) => await handleChallengeRequest(ctx)
      ),
    },
  } satisfies BetterAuthPlugin;
}

function handleChallengeRequest(
  ctx: GenericEndpointContext
): Response | Promise<Response> {
  const ip = getClientIp(ctx.headers ?? new Headers());
  const { limited, retryAfter } = fpaLimiter.check(ip);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  // Lazy cleanup of expired sessions
  db.delete(authChallengeSessions)
    .where(lt(authChallengeSessions.expiresAt, new Date()))
    .then(
      () => undefined,
      () => undefined
    );

  const body = ctx.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    return errorJson(400, "invalid_request", "Missing request body");
  }

  if (body.auth_session && body.opaque_finish_request) {
    return handleOpaqueFinish(ctx, body);
  }
  if (body.auth_session && body.eip712_signature) {
    return handleEip712Finish(ctx, body);
  }
  if (body.auth_session && body.opaque_login_request) {
    return handleOpaqueStart(ctx, body);
  }
  if (body.client_id && body.identifier) {
    return handleInitialRequest(ctx, body);
  }
  if (body.auth_session) {
    return handleStepUpReEntry(ctx, body);
  }

  return errorJson(400, "invalid_request", "Unrecognized request format");
}

// ── Round 1: Identify user, choose challenge type ───────

async function handleInitialRequest(
  ctx: GenericEndpointContext,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = InitialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "invalid_request", parsed.error.issues[0]?.message);
  }
  const { resource, ...rest } = parsed.data;
  const params = {
    ...rest,
    resource:
      resource && !isZentityHostedResource(resource) ? resource : undefined,
  };

  if (
    params.claims &&
    !params.scope.split(SCOPE_SEPARATOR_RE).includes("openid")
  ) {
    return errorJson(
      400,
      "invalid_request",
      "claims parameter requires openid scope"
    );
  }

  // Validate client
  const client = await db
    .select({
      clientId: oauthClients.clientId,
      firstParty: oauthClients.firstParty,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, params.client_id))
    .get();
  if (!client) {
    return errorJson(400, "invalid_client", "Unknown client_id");
  }

  // Non-first-party clients must use standard browser-based OAuth
  if (!client.firstParty) {
    const authSession = randomBytes(32).toString("base64url");
    await db.insert(authChallengeSessions).values({
      authSession,
      clientId: params.client_id,
      userId: null,
      dpopJkt: null,
      scope: params.scope,
      claims: params.claims ?? null,
      resource: params.resource ?? null,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method,
      state: "pending",
      challengeType: "redirect_to_web",
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
    });
    return errorJson(400, "redirect_to_web", undefined, {
      auth_session: authSession,
    });
  }

  // The verified DPoP key binds every later round of this auth_session.
  const dpopJkt = await verifiedDpopJkt(ctx);

  // Resolve user — by wallet address or email
  const identifier = params.identifier.trim();
  let user: { id: string } | undefined;
  let walletInfo: { address: string; chainId: number } | null = null;

  if (ETH_ADDRESS_RE.test(identifier)) {
    const checksummed = getAddress(identifier);
    const wallet = await db
      .select({
        userId: walletAddresses.userId,
        address: walletAddresses.address,
        chainId: walletAddresses.chainId,
      })
      .from(walletAddresses)
      .where(eq(walletAddresses.address, checksummed))
      .get();
    if (wallet) {
      user = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, wallet.userId))
        .get();
      walletInfo = { address: wallet.address, chainId: wallet.chainId };
    }
  } else {
    user = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, identifier.toLowerCase()))
      .get();
  }

  // Determine challenge type based on available credentials
  // Priority: OPAQUE > EIP-712 wallet > redirect_to_web (passkey-only)
  // Unknown users get OPAQUE challenge (timing-safe — indistinguishable from real OPAQUE users)
  let challengeType: "opaque" | "eip712" | "redirect_to_web" = "opaque";
  if (user) {
    const opaqueAccount = await db
      .select({ registrationRecord: accounts.registrationRecord })
      .from(accounts)
      .where(
        and(eq(accounts.userId, user.id), eq(accounts.providerId, "opaque"))
      )
      .get();
    if (opaqueAccount?.registrationRecord) {
      challengeType = "opaque";
    } else {
      const walletAccount = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(eq(accounts.userId, user.id), eq(accounts.providerId, "eip712"))
        )
        .get();
      challengeType = walletAccount ? "eip712" : "redirect_to_web";
    }
  }

  // Create challenge session
  const authSession = randomBytes(32).toString("base64url");

  await db.insert(authChallengeSessions).values({
    authSession,
    clientId: params.client_id,
    userId: user?.id ?? null,
    dpopJkt: dpopJkt ?? null,
    scope: params.scope,
    claims: params.claims ?? null,
    resource: params.resource ?? null,
    codeChallenge: params.code_challenge,
    codeChallengeMethod: params.code_challenge_method,
    state: "pending",
    challengeType,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  });

  if (challengeType === "redirect_to_web") {
    return errorJson(400, "redirect_to_web", undefined, {
      auth_session: authSession,
    });
  }

  if (challengeType === "eip712") {
    // Resolve wallet address if not already known (email lookup path)
    if (!walletInfo && user) {
      const wallet = await db
        .select({
          address: walletAddresses.address,
          chainId: walletAddresses.chainId,
        })
        .from(walletAddresses)
        .where(eq(walletAddresses.userId, user.id))
        .get();
      if (wallet) {
        walletInfo = { address: wallet.address, chainId: wallet.chainId };
      }
    }

    if (!walletInfo) {
      return errorJson(401, "access_denied", "Authentication failed");
    }

    // Need session ID for the update — query by authSession
    const createdSession = await loadSession(authSession);
    if (!createdSession) {
      return errorJson(500, "server_error", "Session creation failed");
    }

    const chainId = params.chain_id ?? walletInfo.chainId;
    return issueEip712Challenge(createdSession.id, authSession, {
      address: walletInfo.address,
      chainId,
    });
  }

  await ready;
  const serverPublicKey = server.getPublicKey(env.OPAQUE_SERVER_SETUP);

  return Response.json(
    {
      auth_session: authSession,
      challenge_type: "opaque",
      error: "insufficient_authorization",
      server_public_key: serverPublicKey,
    },
    { status: 401 }
  );
}

// ── Round 2: OPAQUE startLogin ──────────────────────────

async function handleOpaqueStart(
  ctx: GenericEndpointContext,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = OpaqueStartSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "invalid_request", parsed.error.issues[0]?.message);
  }
  const { auth_session, opaque_login_request } = parsed.data;

  const sessionOrError = await validateChallengeSession(auth_session);
  if (sessionOrError instanceof Response) {
    return sessionOrError;
  }
  const session = sessionOrError;
  if (session.challengeType !== "opaque") {
    return errorJson(400, "invalid_session", "Invalid session state");
  }

  const dpopError = await checkDpopContinuity(ctx, session);
  if (dpopError) {
    return dpopError;
  }

  await ready;

  try {
    validateBase64Length(
      opaque_login_request,
      LOGIN_REQUEST_LENGTH,
      "login request"
    );
  } catch {
    return errorJson(400, "invalid_request", "Invalid OPAQUE login request");
  }

  // Resolve registration record (dummy for unknown users — timing-safe)
  let registrationRecord: string;
  let loginUserIdentifier: string;

  const opaqueAccount = session.userId
    ? await db
        .select({ registrationRecord: accounts.registrationRecord })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, session.userId),
            eq(accounts.providerId, "opaque")
          )
        )
        .get()
    : null;

  if (opaqueAccount?.registrationRecord && session.userId) {
    registrationRecord = opaqueAccount.registrationRecord;
    loginUserIdentifier = session.userId;
  } else {
    const dummy = await createDummyRegistrationRecord();
    registrationRecord = dummy.registrationRecord;
    loginUserIdentifier = dummy.userIdentifier;
  }

  const { serverLoginState, loginResponse } = server.startLogin({
    serverSetup: env.OPAQUE_SERVER_SETUP,
    userIdentifier: loginUserIdentifier,
    registrationRecord,
    startLoginRequest: opaque_login_request,
  });

  const encryptedState = await encryptServerLoginState({
    serverLoginState,
    userId: session.userId,
    secret: getOpaqueStateKey(),
  });

  await db
    .update(authChallengeSessions)
    .set({ opaqueServerState: encryptedState })
    .where(eq(authChallengeSessions.id, session.id));

  return Response.json({ opaque_login_response: loginResponse });
}

// ── Round 3: OPAQUE finishLogin + issue auth code ───────

async function handleOpaqueFinish(
  ctx: GenericEndpointContext,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = OpaqueFinishSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "invalid_request", parsed.error.issues[0]?.message);
  }
  const { auth_session, opaque_finish_request } = parsed.data;

  const sessionOrError = await validateChallengeSession(auth_session);
  if (sessionOrError instanceof Response) {
    return sessionOrError;
  }
  const session = sessionOrError;
  if (!session.opaqueServerState) {
    return errorJson(400, "invalid_session", "OPAQUE round 2 not completed");
  }

  const dpopError = await checkDpopContinuity(ctx, session);
  if (dpopError) {
    return dpopError;
  }

  await ready;

  // Decrypt state and verify OPAQUE finish
  let userId: string | null;
  try {
    const decrypted = await decryptServerLoginState({
      encryptedState: session.opaqueServerState,
      secret: getOpaqueStateKey(),
    });

    const { sessionKey } = server.finishLogin({
      finishLoginRequest: opaque_finish_request,
      serverLoginState: decrypted.serverLoginState,
    });

    if (!(sessionKey && decrypted.userId)) {
      return errorJson(401, "access_denied", "Authentication failed");
    }
    userId = decrypted.userId;
  } catch {
    return errorJson(401, "access_denied", "Authentication failed");
  }

  // Verify user still exists
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) {
    return errorJson(401, "access_denied", "Authentication failed");
  }

  return issueAuthorizationCode(ctx, session, user.id, auth_session);
}

// ── EIP-712 Round 2: Verify signature + issue auth code ─

async function handleEip712Finish(
  ctx: GenericEndpointContext,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = Eip712FinishSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "invalid_request", parsed.error.issues[0]?.message);
  }
  const { auth_session, eip712_signature } = parsed.data;

  const sessionOrError = await validateChallengeSession(auth_session);
  if (sessionOrError instanceof Response) {
    return sessionOrError;
  }
  const session = sessionOrError;
  if (session.challengeType !== "eip712") {
    return errorJson(400, "invalid_session", "Invalid session state");
  }
  if (!(session.opaqueServerState && session.userId)) {
    return errorJson(400, "invalid_session", "EIP-712 round 1 not completed");
  }

  const dpopError = await checkDpopContinuity(ctx, session);
  if (dpopError) {
    return dpopError;
  }

  // Parse wallet context from session
  const wallet = JSON.parse(session.opaqueServerState) as {
    walletAddress: string;
    chainId: number;
    nonce: string;
    nonceIdentifier: string;
  };

  // Consume nonce (single-use)
  const nonceRow = await db
    .select({ id: verifications.id, value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, wallet.nonceIdentifier))
    .get();

  if (!nonceRow || nonceRow.value !== wallet.nonce) {
    return errorJson(401, "access_denied", "Nonce expired or already used");
  }

  await db
    .delete(verifications)
    .where(eq(verifications.identifier, wallet.nonceIdentifier));

  // Verify signature
  const typedData = buildDefaultTypedData(
    wallet.walletAddress,
    wallet.chainId,
    wallet.nonce,
    EIP712_APP_NAME
  );

  const valid = await verifyEip712Signature(
    eip712_signature,
    typedData,
    wallet.walletAddress
  );
  if (!valid) {
    return errorJson(401, "access_denied", "Invalid signature");
  }

  // Verify user still exists
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) {
    return errorJson(401, "access_denied", "Authentication failed");
  }

  return issueAuthorizationCode(ctx, session, user.id, auth_session);
}

async function resolveExistingBrowserAuth(
  ctx: GenericEndpointContext,
  userId: string
): Promise<{
  authContextId: string;
  authTimeMs: number;
  sessionId: string;
} | null> {
  const browserSession = await getSessionFromCtx(ctx);

  if (!(browserSession?.user?.id === userId && browserSession.session.id)) {
    return null;
  }

  const authState = await getAuthenticationStateBySessionId(
    browserSession.session.id
  );
  if (!authState) {
    return null;
  }

  return {
    sessionId: browserSession.session.id,
    authContextId: authState.id,
    authTimeMs: authState.authenticatedAt * 1000,
  };
}

// ── Step-up re-entry: resume auth after 403 ─────────────

async function resolveCredentialType(
  userId: string
): Promise<"opaque" | "eip712" | "redirect_to_web"> {
  const opaqueAccount = await db
    .select({ registrationRecord: accounts.registrationRecord })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "opaque")))
    .get();

  if (opaqueAccount?.registrationRecord) {
    return "opaque";
  }

  const walletAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "eip712")))
    .get();

  return walletAccount ? "eip712" : "redirect_to_web";
}

async function handleStepUpReEntry(
  ctx: GenericEndpointContext,
  body: Record<string, unknown>
): Promise<Response> {
  const authSession =
    typeof body.auth_session === "string" ? body.auth_session : "";
  if (!authSession) {
    return errorJson(400, "invalid_request", "Missing auth_session");
  }

  const session = await loadSession(authSession);
  if (!session || isExpired(session)) {
    return errorJson(400, "invalid_session", "Session expired or not found");
  }

  const dpopError = await checkDpopContinuity(ctx, session);
  if (dpopError) {
    return dpopError;
  }

  // ACR re-check: user already authenticated, retrying after tier upgrade
  if (session.state === "authenticated") {
    if (!session.userId) {
      return errorJson(400, "invalid_session", "Invalid session state");
    }
    return issueAuthorizationCode(ctx, session, session.userId, authSession);
  }

  // Only pending step-up sessions (created without challengeType) continue
  if (session.state !== "pending") {
    return errorJson(400, "invalid_session", "Invalid session state");
  }
  if (session.challengeType) {
    return errorJson(400, "invalid_session", "Invalid session state");
  }
  if (!session.userId) {
    return errorJson(400, "invalid_session", "No user associated with session");
  }

  // Verify user still exists
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) {
    return errorJson(401, "access_denied", "User not found");
  }

  // Accept optional PKCE (required by OAuth 2.1 for public clients)
  const codeChallenge =
    typeof body.code_challenge === "string" ? body.code_challenge : undefined;
  let codeChallengeMethod: string | undefined;
  if (typeof body.code_challenge_method === "string") {
    codeChallengeMethod = body.code_challenge_method;
  } else if (codeChallenge) {
    codeChallengeMethod = "S256";
  }

  const challengeType = await resolveCredentialType(user.id);

  // Update session with resolved challenge type (and PKCE if provided)
  await db
    .update(authChallengeSessions)
    .set({
      challengeType,
      ...(codeChallenge && { codeChallenge, codeChallengeMethod }),
    })
    .where(eq(authChallengeSessions.id, session.id));

  if (challengeType === "redirect_to_web") {
    return errorJson(
      400,
      "redirect_to_web",
      "Passkey-only users must use browser flow",
      { auth_session: authSession }
    );
  }

  if (challengeType === "eip712") {
    const wallet = await db
      .select({
        address: walletAddresses.address,
        chainId: walletAddresses.chainId,
      })
      .from(walletAddresses)
      .where(eq(walletAddresses.userId, user.id))
      .get();

    if (!wallet) {
      return errorJson(401, "access_denied", "Authentication failed");
    }

    return issueEip712Challenge(session.id, authSession, wallet);
  }

  // OPAQUE
  await ready;
  const serverPublicKey = server.getPublicKey(env.OPAQUE_SERVER_SETUP);

  return Response.json(
    {
      auth_session: authSession,
      challenge_type: "opaque",
      error: "insufficient_authorization",
      server_public_key: serverPublicKey,
    },
    { status: 401 }
  );
}

// ── Shared: Issue authorization code ────────────────────

async function issueAuthorizationCode(
  ctx: GenericEndpointContext,
  session: AuthChallengeSession,
  userId: string,
  authSession: string
): Promise<Response> {
  if (session.acrValues) {
    const assurance = await getAccountAssurance(userId, {
      isAuthenticated: true,
    });
    const satisfied = findSatisfiedAcr(session.acrValues, assurance.tier);
    if (!satisfied) {
      await db
        .update(authChallengeSessions)
        .set({ state: "authenticated" })
        .where(eq(authChallengeSessions.id, session.id));

      return errorJson(
        403,
        "insufficient_authorization",
        `Assurance tier-${assurance.tier} does not satisfy ${session.acrValues}`,
        { auth_session: authSession }
      );
    }
  }

  const code = generateRandomString(32, "a-z", "A-Z", "0-9");
  const codeHash = hashCode(code);
  const now = new Date();
  const iat = Math.floor(now.getTime() / 1000);

  const existingBrowserAuth =
    session.state === "authenticated"
      ? await resolveExistingBrowserAuth(ctx, userId)
      : null;

  let sessionId: string;
  let authContextId: string;
  let authTimeMs: number;

  if (existingBrowserAuth) {
    sessionId = existingBrowserAuth.sessionId;
    authContextId = existingBrowserAuth.authContextId;
    authTimeMs = existingBrowserAuth.authTimeMs;
  } else {
    if (
      session.challengeType !== "opaque" &&
      session.challengeType !== "eip712"
    ) {
      return errorJson(
        400,
        "invalid_session",
        "Missing authentication context"
      );
    }

    const authContext = await createAuthenticationContext({
      userId,
      loginMethod: session.challengeType === "opaque" ? "opaque" : "eip712",
      authenticatedAt: now,
      sourceKind:
        session.challengeType === "opaque"
          ? "authorize_challenge_opaque"
          : "authorize_challenge_eip712",
      referenceType: "authorization_code",
      referenceId: codeHash,
    });

    sessionId = randomBytes(16).toString("hex");
    authContextId = authContext.id;
    authTimeMs = authContext.authenticatedAt * 1000;

    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(sessions).values({
      id: sessionId,
      token: sessionToken,
      userId,
      authContextId,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      createdAt: now,
      updatedAt: now,
    });
  }

  // The ID token asserts the same acr and amr the browser flow's
  // authenticationContext would.
  const [assurance, authentication] = await Promise.all([
    getAccountAssurance(userId, { isAuthenticated: true }),
    getAuthenticationStateBySessionId(sessionId),
  ]);

  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: codeHash,
    value: JSON.stringify({
      type: "authorization_code",
      referenceId: codeHash,
      query: {
        client_id: session.clientId,
        scope: session.scope,
        // Headless first-party codes carry no redirect_uri, which the token
        // endpoint accepts because none was bound (RFC 6749 §4.1.3).
        // dpop_jkt makes the token endpoint require a proof from the key
        // that authenticated this auth_session (RFC 9449 §10).
        ...(session.dpopJkt && { dpop_jkt: session.dpopJkt }),
        ...(session.claims && { claims: session.claims }),
        ...(session.codeChallenge && {
          code_challenge: session.codeChallenge,
          code_challenge_method: session.codeChallengeMethod,
        }),
        ...(session.resource && { resource: session.resource }),
      },
      userId,
      sessionId,
      authContextId,
      authTime: authTimeMs,
      acr: computeAcr(assurance.tier),
      ...(authentication?.amr.length ? { amr: authentication.amr } : {}),
      authSession,
    }),
    expiresAt: new Date((iat + CODE_LIFETIME_S) * 1000),
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(authChallengeSessions)
    .set({
      state: "code_issued",
      authorizationCode: codeHash,
      resolvedAuthContextId: authContextId,
      userId,
    })
    .where(eq(authChallengeSessions.id, session.id));

  return Response.json({ authorization_code: code });
}
