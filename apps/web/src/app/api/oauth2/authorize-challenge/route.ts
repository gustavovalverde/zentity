import { createHash, randomBytes } from "node:crypto";

import { ready, server } from "@serenity-kit/opaque";
import { generateRandomString } from "better-auth/crypto";
import { and, eq, lt } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";
import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";

import { env } from "@/env";
import { getAccountAssurance } from "@/lib/assurance/data";
import { auth } from "@/lib/auth/auth";
import {
  createAuthenticationContext,
  getAuthenticationStateBySessionId,
} from "@/lib/auth/authentication-context";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import {
  buildDefaultTypedData,
  nonceIdentifier,
  verifyEip712Signature,
} from "@/lib/auth/plugins/eip712/utils";
import {
  createDummyRegistrationRecord,
  decryptServerLoginState,
  encryptServerLoginState,
  LOGIN_REQUEST_LENGTH,
  validateBase64Length,
} from "@/lib/auth/plugins/opaque/utils";
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
} from "@/lib/db/schema/auth-challenge";
import { haipPushedRequests } from "@/lib/db/schema/haip";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { getOpaqueStateKey } from "@/lib/privacy/primitives/derived-keys";

const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const CODE_LIFETIME_S = 600;
const PAR_LIFETIME_MS = 60 * 1000;
const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";
const EIP712_NONCE_TTL_MS = 15 * 60 * 1000;
const EIP712_APP_NAME = "Zentity";
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

// ── Rate limiter (sliding window per IP) ────────────────

import {
  createRealRateLimiter,
  getClientIp,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";

export const fpaLimiter = createRealRateLimiter({ windowMs: 60_000, max: 10 });

// ── Request schemas ─────────────────────────────────────

const InitialRequestSchema = z.object({
  chain_id: z.number().int().positive().optional(),
  client_id: z.string().min(1),
  claims: z.string().optional(),
  code_challenge: z.string().min(43).optional(),
  code_challenge_method: z.string().default("S256").optional(),
  identifier: z.string().min(1),
  resource: z.string().url().optional(),
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
  return NextResponse.json(
    { error, ...(description && { error_description: description }), ...extra },
    { status }
  );
}

async function extractDpopJkt(request: Request): Promise<string | undefined> {
  const proof = request.headers.get("DPoP");
  if (!proof) {
    return undefined;
  }
  try {
    const header = decodeProtectedHeader(proof);
    if (header.jwk) {
      return await calculateJwkThumbprint(
        header.jwk as Record<string, unknown>
      );
    }
  } catch {
    // DPoP proof parsing failed
  }
  return undefined;
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
  request: Request,
  session: AuthChallengeSession
): Promise<Response | null> {
  const dpopJkt = await extractDpopJkt(request);
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
    expiresAt: new Date(Date.now() + EIP712_NONCE_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

  return NextResponse.json(
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

// ── Route handler ───────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request.headers);
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

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return errorJson(400, "invalid_request", "Missing request body");
  }

  if (body.auth_session && body.opaque_finish_request) {
    return handleOpaqueFinish(request, body);
  }
  if (body.auth_session && body.eip712_signature) {
    return handleEip712Finish(request, body);
  }
  if (body.auth_session && body.opaque_login_request) {
    return handleOpaqueStart(request, body);
  }
  if (body.client_id && body.identifier) {
    return handleInitialRequest(request, body);
  }
  if (body.auth_session) {
    return handleStepUpReEntry(request, body);
  }

  return errorJson(400, "invalid_request", "Unrecognized request format");
}

// ── Round 1: Identify user, choose challenge type ───────

async function handleInitialRequest(
  request: Request,
  body: Record<string, unknown>
): Promise<Response> {
  const parsed = InitialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "invalid_request", parsed.error.issues[0]?.message);
  }
  const params = parsed.data;

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

  // Extract DPoP thumbprint (bound to all subsequent requests)
  const dpopJkt = await extractDpopJkt(request);

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
    const extras: Record<string, unknown> = { auth_session: authSession };

    // Include PAR request_uri when PKCE was provided (FPA draft §3.2)
    if (params.code_challenge) {
      const requestId = generateRandomString(32, "a-z", "A-Z", "0-9");
      await db.insert(haipPushedRequests).values({
        requestId,
        clientId: params.client_id,
        requestParams: JSON.stringify({
          client_id: params.client_id,
          response_type: params.response_type,
          scope: params.scope,
          ...(params.claims && { claims: params.claims }),
          code_challenge: params.code_challenge,
          code_challenge_method: params.code_challenge_method,
          ...(params.resource && { resource: params.resource }),
        }),
        expiresAt: new Date(Date.now() + PAR_LIFETIME_MS),
      });
      extras.request_uri = `${PAR_URI_PREFIX}${requestId}`;
    }

    return errorJson(400, "redirect_to_web", undefined, extras);
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

  return NextResponse.json(
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
  request: Request,
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

  const dpopError = await checkDpopContinuity(request, session);
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

  return NextResponse.json({ opaque_login_response: loginResponse });
}

// ── Round 3: OPAQUE finishLogin + issue auth code ───────

async function handleOpaqueFinish(
  request: Request,
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

  const dpopError = await checkDpopContinuity(request, session);
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

  return issueAuthorizationCode(request, session, user.id, auth_session);
}

// ── EIP-712 Round 2: Verify signature + issue auth code ─

async function handleEip712Finish(
  request: Request,
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

  const dpopError = await checkDpopContinuity(request, session);
  if (dpopError) {
    return dpopError;
  }

  // Parse wallet context from session
  const ctx = JSON.parse(session.opaqueServerState) as {
    walletAddress: string;
    chainId: number;
    nonce: string;
    nonceIdentifier: string;
  };

  // Consume nonce (single-use)
  const nonceRow = await db
    .select({ id: verifications.id, value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, ctx.nonceIdentifier))
    .get();

  if (!nonceRow || nonceRow.value !== ctx.nonce) {
    return errorJson(401, "access_denied", "Nonce expired or already used");
  }

  await db
    .delete(verifications)
    .where(eq(verifications.identifier, ctx.nonceIdentifier));

  // Verify signature
  const typedData = buildDefaultTypedData(
    ctx.walletAddress,
    ctx.chainId,
    ctx.nonce,
    EIP712_APP_NAME
  );

  const valid = await verifyEip712Signature(
    eip712_signature,
    typedData,
    ctx.walletAddress
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

  return issueAuthorizationCode(request, session, user.id, auth_session);
}

async function resolveExistingBrowserAuth(
  request: Request,
  userId: string
): Promise<{
  authContextId: string;
  authTimeMs: number;
  sessionId: string;
} | null> {
  const browserSession = await auth.api.getSession({
    headers: request.headers,
  });

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
  request: Request,
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

  const dpopError = await checkDpopContinuity(request, session);
  if (dpopError) {
    return dpopError;
  }

  // ACR re-check: user already authenticated, retrying after tier upgrade
  if (session.state === "authenticated") {
    if (!session.userId) {
      return errorJson(400, "invalid_session", "Invalid session state");
    }
    return issueAuthorizationCode(
      request,
      session,
      session.userId,
      authSession
    );
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
    const extras: Record<string, unknown> = { auth_session: authSession };

    const effectiveCodeChallenge = codeChallenge ?? session.codeChallenge;
    if (effectiveCodeChallenge) {
      const requestId = generateRandomString(32, "a-z", "A-Z", "0-9");
      await db.insert(haipPushedRequests).values({
        requestId,
        clientId: session.clientId,
        requestParams: JSON.stringify({
          client_id: session.clientId,
          response_type: "code",
          scope: session.scope,
          ...(session.claims && { claims: session.claims }),
          code_challenge: effectiveCodeChallenge,
          code_challenge_method:
            codeChallengeMethod ?? session.codeChallengeMethod ?? "S256",
          ...(session.resource && { resource: session.resource }),
        }),
        expiresAt: new Date(Date.now() + PAR_LIFETIME_MS),
      });
      extras.request_uri = `${PAR_URI_PREFIX}${requestId}`;
    }

    return errorJson(
      400,
      "redirect_to_web",
      "Passkey-only users must use browser flow",
      extras
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

  return NextResponse.json(
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
  request: Request,
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
      ? await resolveExistingBrowserAuth(request, userId)
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
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: codeHash,
    value: JSON.stringify({
      type: "authorization_code",
      referenceId: codeHash,
      query: {
        client_id: session.clientId,
        scope: session.scope,
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
      authSession,
    }),
    expiresAt: new Date((iat + CODE_LIFETIME_S) * 1000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
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

  return NextResponse.json({ authorization_code: code });
}
