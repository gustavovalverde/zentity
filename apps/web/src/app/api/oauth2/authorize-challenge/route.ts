import { createHash, randomBytes } from "node:crypto";

import { ready, server } from "@serenity-kit/opaque";
import { generateRandomString } from "better-auth/crypto";
import { and, eq, lt } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";
import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";

import { env } from "@/env";
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

const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const CODE_LIFETIME_S = 600;
const PAR_LIFETIME_MS = 60 * 1000;
const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const EIP712_NONCE_TTL_MS = 15 * 60 * 1000;
const EIP712_APP_NAME = "Zentity";
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

// ── Rate limiter (sliding window per IP) ────────────────

export const ipRequestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = ipRequestLog.get(ip)?.filter((t) => t > windowStart) ?? [];
  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// ── Request schemas ─────────────────────────────────────

const InitialRequestSchema = z.object({
  chain_id: z.number().int().positive().optional(),
  client_id: z.string().min(1),
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

// ── Route handler ───────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return errorJson(429, "too_many_requests", "Rate limit exceeded");
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

    const chainId = params.chain_id ?? walletInfo.chainId;
    const nonce = crypto.randomUUID();
    const nid = nonceIdentifier(walletInfo.address, chainId);

    await db.insert(verifications).values({
      id: randomBytes(16).toString("hex"),
      identifier: nid,
      value: nonce,
      expiresAt: new Date(Date.now() + EIP712_NONCE_TTL_MS).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Store wallet context on the session for round 2
    await db
      .update(authChallengeSessions)
      .set({
        opaqueServerState: JSON.stringify({
          walletAddress: walletInfo.address,
          chainId,
          nonce,
          nonceIdentifier: nid,
        }),
      })
      .where(eq(authChallengeSessions.authSession, authSession));

    const typedData = buildDefaultTypedData(
      walletInfo.address,
      chainId,
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

  const session = await loadSession(auth_session);
  if (!session || isExpired(session)) {
    return errorJson(400, "invalid_session", "Session expired or not found");
  }
  if (session.state !== "pending" || session.challengeType !== "opaque") {
    return errorJson(400, "invalid_session", "Invalid session state");
  }

  // DPoP key continuity
  const dpopJkt = await extractDpopJkt(request);
  if (session.dpopJkt && dpopJkt !== session.dpopJkt) {
    return errorJson(400, "invalid_session", "DPoP key mismatch");
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

  // Resolve registration record
  let registrationRecord: string;
  let loginUserIdentifier: string;

  if (session.userId) {
    const opaqueAccount = await db
      .select({ registrationRecord: accounts.registrationRecord })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, session.userId),
          eq(accounts.providerId, "opaque")
        )
      )
      .get();

    if (opaqueAccount?.registrationRecord) {
      registrationRecord = opaqueAccount.registrationRecord;
      loginUserIdentifier = session.userId;
    } else {
      const dummy = await createDummyRegistrationRecord();
      registrationRecord = dummy.registrationRecord;
      loginUserIdentifier = dummy.userIdentifier;
    }
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
    secret: env.BETTER_AUTH_SECRET,
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

  const session = await loadSession(auth_session);
  if (!session || isExpired(session)) {
    return errorJson(400, "invalid_session", "Session expired or not found");
  }
  if (session.state !== "pending" || !session.opaqueServerState) {
    return errorJson(400, "invalid_session", "OPAQUE round 2 not completed");
  }

  // DPoP key continuity
  const dpopJkt = await extractDpopJkt(request);
  if (session.dpopJkt && dpopJkt !== session.dpopJkt) {
    return errorJson(400, "invalid_session", "DPoP key mismatch");
  }

  await ready;

  // Decrypt state and verify OPAQUE finish
  let userId: string | null;
  try {
    const decrypted = await decryptServerLoginState({
      encryptedState: session.opaqueServerState,
      secret: env.BETTER_AUTH_SECRET,
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

  return issueAuthorizationCode(session, user.id, auth_session);
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

  const session = await loadSession(auth_session);
  if (!session || isExpired(session)) {
    return errorJson(400, "invalid_session", "Session expired or not found");
  }
  if (session.state !== "pending" || session.challengeType !== "eip712") {
    return errorJson(400, "invalid_session", "Invalid session state");
  }
  if (!(session.opaqueServerState && session.userId)) {
    return errorJson(400, "invalid_session", "EIP-712 round 1 not completed");
  }

  // DPoP key continuity
  const dpopJkt = await extractDpopJkt(request);
  if (session.dpopJkt && dpopJkt !== session.dpopJkt) {
    return errorJson(400, "invalid_session", "DPoP key mismatch");
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

  return issueAuthorizationCode(session, user.id, auth_session);
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
  // Only step-up sessions (created without challengeType) can enter here
  if (session.state !== "pending" || session.challengeType) {
    return errorJson(400, "invalid_session", "Invalid session state");
  }
  if (!session.userId) {
    return errorJson(400, "invalid_session", "No user associated with session");
  }

  // DPoP key continuity
  const dpopJkt = await extractDpopJkt(request);
  if (session.dpopJkt && dpopJkt !== session.dpopJkt) {
    return errorJson(400, "invalid_session", "DPoP key mismatch");
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

  const challengeType = await resolveCredentialType(user.id);

  // Update session with resolved challenge type
  await db
    .update(authChallengeSessions)
    .set({ challengeType })
    .where(eq(authChallengeSessions.id, session.id));

  if (challengeType === "redirect_to_web") {
    return errorJson(
      400,
      "redirect_to_web",
      "Passkey-only users must use browser flow"
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
      .where(eq(authChallengeSessions.id, session.id));

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
  session: AuthChallengeSession,
  userId: string,
  authSession: string
): Promise<Response> {
  const code = generateRandomString(32, "a-z", "A-Z", "0-9");
  const codeHash = hashCode(code);
  const iat = Math.floor(Date.now() / 1000);

  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: codeHash,
    value: JSON.stringify({
      type: "authorization_code",
      query: {
        client_id: session.clientId,
        scope: session.scope,
        ...(session.codeChallenge && {
          code_challenge: session.codeChallenge,
          code_challenge_method: session.codeChallengeMethod,
        }),
        ...(session.resource && { resource: session.resource }),
      },
      userId,
      authTime: Date.now(),
      authSession,
    }),
    expiresAt: new Date((iat + CODE_LIFETIME_S) * 1000).toISOString(),
    createdAt: new Date(iat * 1000).toISOString(),
    updatedAt: new Date(iat * 1000).toISOString(),
  });

  await db
    .update(authChallengeSessions)
    .set({ state: "code_issued", authorizationCode: codeHash, userId })
    .where(eq(authChallengeSessions.id, session.id));

  return NextResponse.json({ authorization_code: code });
}
