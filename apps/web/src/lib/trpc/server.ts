/**
 * tRPC Server Configuration
 *
 * Sets up the tRPC router infrastructure with authentication and logging middleware.
 * All tRPC routers use these base procedures to handle public and
 * authenticated requests consistently.
 */
import type { AuthenticationState } from "@zentity/sdk/protocol";
import "server-only";

import type { FeatureName } from "@/lib/assurance/tier";
import type { RateLimiter } from "@/lib/http/rate-limit";

import { DPOP_NONCE_HEADER } from "@better-auth/core/oauth2";
import { type Attributes, type Span, SpanStatusCode } from "@opentelemetry/api";
import {
  ATTR_ERROR_TYPE,
  ATTR_RPC_STATUS_CODE,
} from "@opentelemetry/semantic-conventions";
import { initTRPC, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { eq } from "drizzle-orm";

import { getSecurityPosture } from "@/lib/assurance/posture";
import { canAccessFeature, getBlockedReason } from "@/lib/assurance/tier";
import { auth, type Session } from "@/lib/auth/auth-config";
import { resolveAuthenticationContext } from "@/lib/auth/auth-context";
import { loadOpaqueAccessTokenAuthContextId } from "@/lib/auth/oidc/haip/opaque-access-token";
import {
  invalidAccessToken,
  missingAccessToken,
  type ResourceError,
} from "@/lib/auth/oidc/resource-challenge";
import { verifyResourceRequest } from "@/lib/auth/oidc/resource-principal";
import {
  checkRecoveryFactorChange,
  REVERIFICATION_REQUIRED,
  REVERIFICATION_REQUIRED_MESSAGE,
  type RecoveryFactorChange,
} from "@/lib/auth/recovery-factors";
import { db } from "@/lib/db/connection";
import { sessions, users } from "@/lib/db/schema/auth";
import { logError, logWarn } from "@/lib/logging/error-logger";
import { createRequestLogger, isDebugEnabled } from "@/lib/logging/logger";
import {
  getRequestLogBindings,
  getSpanAttributesFromContext,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import { hashIdentifier, withSpan } from "@/lib/observability/telemetry";

/** Marks a refusal so the client can ask for a passkey confirmation. */
class RecoveryFactorChangeRefused extends Error {}

/** Base context available to all procedures (public and protected). */
interface TrpcContext {
  authContext?: AuthenticationState | null;
  /** How the session was presented: the browser cookie, or an OAuth access token. */
  authenticatedWith?: "session_cookie" | "access_token" | null;
  /** The next DPoP nonce for a client whose DPoP-bound token verified. */
  dpopNonce?: string | null;
  flowId: string | null;
  flowIdSource: "header" | "none";
  req: Request;
  requestId: string;
  session: Session | null;
  span?: Span;
  /** The `WWW-Authenticate` challenge for a refused OAuth access token. */
  tokenChallenge?: Headers | null;
}

interface ResolvedAuthSession {
  authContext: AuthenticationState | null;
  challenge: Headers | null;
  dpopNonce?: string | undefined;
  session: Session | null;
}

function refusedOAuthSession(error: ResourceError): ResolvedAuthSession {
  return {
    authContext: null,
    challenge: new Headers(error.headers),
    session: null,
  };
}

async function loadPersistedSession(
  sessionId: string
): Promise<Session | null> {
  const sessionRow = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)
    .get();

  if (!sessionRow || new Date(sessionRow.expiresAt) < new Date()) {
    return null;
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, sessionRow.userId))
    .limit(1)
    .get();

  if (!user) {
    return null;
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    },
    session: {
      ...sessionRow,
      expiresAt: new Date(sessionRow.expiresAt),
      createdAt: new Date(sessionRow.createdAt),
      updatedAt: new Date(sessionRow.updatedAt),
    },
  } as unknown as Session;
}

/**
 * Resolve a user from an OAuth access token (DPoP or Bearer). User access
 * tokens for Zentity's own endpoints are opaque; a DPoP-bound token needs a
 * valid proof.
 */
async function resolveOAuthSession(req: Request): Promise<ResolvedAuthSession> {
  if (!req.headers.get("authorization")) {
    // Points an OAuth client probing without a token at the resource
    // metadata (RFC 9728 §5). Browsers ignore Bearer challenges.
    return refusedOAuthSession(missingAccessToken());
  }

  const verified = await verifyResourceRequest(req);
  if (!verified.ok) {
    return refusedOAuthSession(verified.error);
  }
  const userId =
    typeof verified.payload.sub === "string" ? verified.payload.sub : undefined;
  if (!(verified.format === "opaque" && userId)) {
    return refusedOAuthSession(
      invalidAccessToken(req, "access token is not valid for this resource")
    );
  }

  const sessionId =
    typeof verified.payload.sid === "string" ? verified.payload.sid : null;
  const authContext = await resolveAuthenticationContext({
    authContextId: await loadOpaqueAccessTokenAuthContextId(verified.token),
    sessionId,
  });

  if (sessionId) {
    const session = await loadPersistedSession(sessionId);
    if (!(session && authContext)) {
      return refusedOAuthSession(
        invalidAccessToken(req, "access token session has ended")
      );
    }
    return {
      session,
      authContext,
      challenge: null,
      dpopNonce: verified.dpopNonce,
    };
  }

  if (!authContext) {
    return refusedOAuthSession(
      invalidAccessToken(req, "access token session has ended")
    );
  }

  return {
    authContext,
    challenge: null,
    dpopNonce: verified.dpopNonce,
    session: await buildSessionFromUserId(userId, {
      authContextId: authContext.id,
    }),
  };
}

async function buildSessionFromUserId(
  userId: string,
  options?: { authContextId?: string | null; sessionId?: string }
): Promise<Session | null> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .get();

  if (!user) {
    return null;
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    },
    session: {
      id: options?.sessionId ?? `oauth:${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      token: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      authContextId: options?.authContextId ?? null,
      ipAddress: null,
      userAgent: null,
    },
  } as unknown as Session;
}

/**
 * Creates the tRPC context from an incoming request.
 * Resolves session from cookies (browser) or OAuth access token (MCP/API).
 */
export async function createTrpcContext(args: {
  req: Request;
}): Promise<TrpcContext> {
  const requestContext = resolveRequestContext(args.req.headers);
  let session: Session | null = null;
  let authContext: AuthenticationState | null = null;
  let authenticatedWith: TrpcContext["authenticatedWith"] = null;
  let tokenChallenge: Headers | null = null;
  let dpopNonce: string | null = null;
  try {
    session = await auth.api.getSession({ headers: args.req.headers });
    if (session) {
      authenticatedWith = "session_cookie";
    }
    if (session?.session?.id) {
      authContext = await resolveAuthenticationContext({
        authContextId:
          (session.session as { authContextId?: string | null } | undefined)
            ?.authContextId ?? null,
        sessionId: session.session.id,
      });
    }
  } catch (error) {
    logError(error, {
      requestId: requestContext.requestId,
      path: "auth.getSession",
    });
  }

  if (!session) {
    try {
      const resolved = await resolveOAuthSession(args.req);
      session = resolved.session;
      authenticatedWith = session ? "access_token" : null;
      authContext = resolved.authContext;
      tokenChallenge = resolved.challenge;
      dpopNonce = resolved.dpopNonce ?? null;
    } catch (error) {
      logError(error, {
        requestId: requestContext.requestId,
        path: "auth.resolveOAuth",
      });
    }
  }

  return {
    req: args.req,
    session: session ?? null,
    authenticatedWith,
    tokenChallenge,
    dpopNonce,
    authContext,
    requestId: requestContext.requestId,
    flowId: requestContext.flowId,
    flowIdSource: requestContext.flowIdSource,
  };
}

/**
 * Sends the access-token challenge with an unauthorized response, so an OAuth
 * client learns why its token was refused (RFC 6750, RFC 9449), and the next
 * DPoP nonce once its DPoP-bound token verified (RFC 9449 §8.2).
 */
export function trpcResponseMeta(opts: {
  ctx?: TrpcContext | undefined;
  errors: TRPCError[];
}): { headers?: Headers } {
  const challenge = opts.ctx?.tokenChallenge;
  if (challenge && opts.errors.some((error) => error.code === "UNAUTHORIZED")) {
    return { headers: challenge };
  }
  const dpopNonce = opts.ctx?.dpopNonce;
  if (dpopNonce) {
    return {
      headers: new Headers({
        [DPOP_NONCE_HEADER]: dpopNonce,
        "Cache-Control": "no-store",
      }),
    };
  }
  return {};
}

const trpc = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error, ctx }) {
    // Sanitize unexpected errors so raw DB/system details never reach clients.
    // Intentional TRPCErrors (BAD_REQUEST, FORBIDDEN, CONFLICT, etc.) keep
    // their messages since we control them. INTERNAL_SERVER_ERROR means an
    // unhandled error slipped through — replace with a generic message.
    // Include a short reference ID so users can report it for debugging.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      const ref = ctx?.requestId?.slice(0, 8);
      const message = ref
        ? `An unexpected error occurred. (Ref: ${ref})`
        : "An unexpected error occurred.";
      return { ...shape, message };
    }
    if (error.cause instanceof RecoveryFactorChangeRefused) {
      return {
        ...shape,
        data: { ...shape.data, reason: REVERIFICATION_REQUIRED },
      };
    }
    return shape;
  },
});

/**
 * Wraps each procedure in a span. tRPC reports failures as a `{ ok: false }`
 * result rather than a throw. Every failure records its tRPC code in
 * `rpc.status_code`; only codes that tRPC maps to HTTP 5xx set `error.type` and
 * mark the span ERROR, following the OpenTelemetry HTTP server convention.
 */
const withTracing = trpc.middleware(({ path, type, ctx, next }) => {
  const attributes: Attributes = {
    "rpc.system": "trpc",
    "rpc.method": path,
    "rpc.type": type,
    ...getSpanAttributesFromContext(ctx),
    "session.id": ctx.session?.session?.id
      ? hashIdentifier(ctx.session.session.id)
      : undefined,
  };

  return withSpan(`trpc.${path}`, attributes, async (span) => {
    const result = await next({ ctx: { ...ctx, span } });
    if (!result.ok) {
      const { code } = result.error;
      span.setAttribute(ATTR_RPC_STATUS_CODE, code);
      if (getHTTPStatusCodeFromError(result.error) >= 500) {
        span.setAttribute(ATTR_ERROR_TYPE, code);
        span.setStatus({ code: SpanStatusCode.ERROR, message: code });
      }
    }
    return result;
  });
});

/**
 * Paths that should log at debug level only (high frequency, low value).
 */
const DEBUG_ONLY_PATHS = new Set([
  "zk.health",
  "zk.challengeStatus",
  "attestation.networks",
  "attestation.status",
  "compliantToken.networks",
]);

/**
 * Critical paths that always log at info level.
 * These get timing logged in debug mode.
 */
const CRITICAL_PATHS = new Set([
  "identity.prepareDocument",
  "identity.livenessStatus",
  "identity.finalize",
  "identity.finalizeStatus",
  "attestation.createPermit",
  "zk.storeProof",
  "zk.verifyProof",
  "compliantToken.mint",
  "account.deleteAccount",
]);

/**
 * Logging middleware - adds request correlation and structured logging.
 * Runs on all procedures, before authentication.
 * Adds log, requestId, and debug to context.
 */
const withLogging = trpc.middleware(async ({ ctx, next, path, type }) => {
  const { requestId } = ctx;
  const log = createRequestLogger(requestId, getRequestLogBindings(ctx));
  const debug = isDebugEnabled();
  const start = performance.now();

  // Determine log level for this path
  const isDebugPath = DEBUG_ONLY_PATHS.has(path);
  const isCritical = CRITICAL_PATHS.has(path);

  // Log request start (path and type only; input is not parsed yet)
  if (isDebugPath) {
    log.debug({ path, type }, "tRPC request");
  } else {
    log.info({ path, type }, "tRPC request");
  }

  // Log a failed procedure with severity tiered by error code. Shared by the
  // thrown-error path and the non-throwing `{ ok: false }` result that tRPC
  // returns from next() — the latter was previously mislabeled as success.
  const logProcedureFailure = (error: unknown) => {
    if (error instanceof TRPCError) {
      // UNAUTHORIZED is expected, log at debug
      if (error.code === "UNAUTHORIZED") {
        log.debug({ path, code: error.code }, "Unauthorized");
        return;
      }

      // Client errors at warn level
      if (
        error.code === "BAD_REQUEST" ||
        error.code === "FORBIDDEN" ||
        error.code === "TOO_MANY_REQUESTS" ||
        error.code === "PRECONDITION_FAILED" ||
        error.code === "NOT_FOUND"
      ) {
        logWarn("tRPC client error", { path, code: error.code }, log);
        return;
      }
    }

    // Server errors (INTERNAL_SERVER_ERROR, etc.) and unexpected throws
    const duration = Math.round(performance.now() - start);
    logError(error, { requestId, path, duration }, log);
  };

  try {
    const result = await next({
      ctx: { ...ctx, log, requestId, debug },
    });

    // tRPC reports resolver/input failures as a non-throwing { ok: false }
    // result; surface them instead of logging a false success.
    if (!result.ok) {
      logProcedureFailure(result.error);
      return result;
    }

    // Log completion (timing only for critical paths in debug mode)
    if (isCritical && debug) {
      const duration = Math.round(performance.now() - start);
      log.info({ path, duration, ok: true }, "tRPC complete");
    } else if (isDebugPath) {
      log.debug({ path, ok: true }, "tRPC complete");
    } else {
      log.info({ path, ok: true }, "tRPC complete");
    }

    return result;
  } catch (error) {
    logProcedureFailure(error);
    throw error;
  }
});

/**
 * Authentication middleware that rejects unauthenticated requests.
 * Extracts userId from session and adds it to context for downstream use.
 */
const enforceAuth = trpc.middleware(({ ctx, next }) => {
  const session = ctx.session;
  const userId = session?.user?.id;
  if (!(session && userId)) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (ctx.span) {
    ctx.span.setAttribute("user.id", hashIdentifier(userId));
  }

  return next({
    ctx: { ...ctx, session, userId },
  });
});

export const router = trpc.router;

/** Procedure for unauthenticated endpoints. Includes logging context. */
export const publicProcedure = trpc.procedure.use(withTracing).use(withLogging);

/** Procedure requiring authentication. Includes logging context and userId. */
export const protectedProcedure = trpc.procedure
  .use(withTracing)
  .use(withLogging)
  .use(enforceAuth);

/** Authenticated procedure limited per user by a shared sliding-window limiter. */
export function rateLimitedProcedure(limiter: RateLimiter) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (limiter.check(ctx.userId).limited) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    }
    return next({ ctx });
  });
}

const ADMIN_ROLES = new Set(["admin"]);

/** Procedure requiring admin role. Extends protectedProcedure with role check. */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const role = (ctx.session.user as Record<string, unknown>).role as
    | string
    | undefined;
  if (!(role && ADMIN_ROLES.has(role))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

/**
 * Creates a middleware that guards a procedure by feature requirements.
 *
 * Checks the user's tier and AAL against the feature requirements.
 * If requirements aren't met, throws a FORBIDDEN error with a descriptive message.
 *
 * @param feature - The feature name to check access for
 * @returns tRPC middleware that adds tierProfile to context
 *
 * @example
 * ```ts
 * export const attestationRouter = router({
 *   submit: protectedProcedure
 *     .use(requireFeature("attestation"))
 *     .mutation(async ({ ctx }) => {
 *       // ctx.tierProfile is available
 *     }),
 * });
 * ```
 */
export function requireFeature(feature: FeatureName) {
  return trpc.middleware(async ({ ctx, next }) => {
    const tierContext = ctx as typeof ctx & {
      authContext: AuthenticationState | null;
      userId: string;
      session: Session;
    };

    const posture = await getSecurityPosture({
      userId: tierContext.userId,
      presentedAuth: {
        authContextId: tierContext.authContext?.id ?? null,
        sessionId: tierContext.session.session.id,
      },
    });

    if (!canAccessFeature(feature, posture.assurance.tier, posture.auth)) {
      const reason = getBlockedReason(
        feature,
        posture.assurance.tier,
        posture.auth
      );
      throw new TRPCError({
        code: "FORBIDDEN",
        message: reason ?? `Feature "${feature}" is not accessible`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        assuranceState: posture,
      },
    });
  });
}

/**
 * Refuses a recovery factor change the account's state does not allow (see
 * `recovery-factors.ts`). Only a browser session counts toward it: an access
 * token's sign-in authorized an OAuth client, not this change.
 */
export async function requireRecoveryFactorChange(
  ctx: Pick<TrpcContext, "authenticatedWith"> & {
    session: Session;
    userId: string;
  },
  change: RecoveryFactorChange
): Promise<void> {
  const decision = await checkRecoveryFactorChange({
    change,
    sessionId:
      ctx.authenticatedWith === "session_cookie"
        ? ctx.session.session.id
        : null,
    userId: ctx.userId,
  });
  if (!decision.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: REVERIFICATION_REQUIRED_MESSAGE,
      cause: new RecoveryFactorChangeRefused(REVERIFICATION_REQUIRED),
    });
  }
}
