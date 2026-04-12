/**
 * tRPC Server Configuration
 *
 * Sets up the tRPC router infrastructure with authentication and logging middleware.
 * All tRPC routers use these base procedures to handle public and
 * authenticated requests consistently.
 */
import "server-only";

import type { AuthenticationState, FeatureName } from "@/lib/assurance/types";

import { randomUUID, timingSafeEqual } from "node:crypto";

import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { getSecurityPosture } from "@/lib/assurance/data";
import { canAccessFeature, getBlockedReason } from "@/lib/assurance/features";
import { auth, type Session } from "@/lib/auth/auth-config";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  resolveAuthenticationContext,
} from "@/lib/auth/authentication-context";
import { verifyAccessToken } from "@/lib/auth/jwt-verify";
import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import { resolveUserIdFromSub } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { sessions, users } from "@/lib/db/schema/auth";
import { logError, logWarn } from "@/lib/logging/error-logger";
import { createRequestLogger, isDebugEnabled } from "@/lib/logging/logger";
import { extractInputMeta } from "@/lib/logging/redact";
import {
  getRequestLogBindings,
  getSpanAttributesFromContext,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import { getTracer, hashIdentifier } from "@/lib/observability/telemetry";

type SpanAttributes = Record<string, string | number | boolean>;

/** Base context available to all procedures (public and protected). */
interface TrpcContext {
  authContext?: AuthenticationState | null;
  flowId: string | null;
  flowIdSource: "header" | "cookie" | "query" | "none";
  req: Request;
  requestId: string;
  /** Response headers that will be merged with tRPC response. Use for Set-Cookie. */
  resHeaders: Headers;
  session: Session | null;
  span?: Span;
  spanId?: string;
  traceId?: string;
}

const AUTH_HEADER_RE = /^(DPoP|Bearer)\s+(.+)$/i;

interface ResolvedAuthSession {
  authContext: AuthenticationState | null;
  session: Session | null;
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
 * Resolve a user from an OAuth access token (DPoP or Bearer).
 * Handles both JWT tokens (decode + sub lookup) and opaque tokens (hash lookup).
 * Validates DPoP proof-of-possession when the token is DPoP-bound (cnf.jkt).
 */
async function resolveOAuthSession(req: Request): Promise<ResolvedAuthSession> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return { session: null, authContext: null };
  }

  const match = authHeader.match(AUTH_HEADER_RE);
  if (!(match?.[1] && match[2])) {
    return { session: null, authContext: null };
  }

  const scheme = match[1];
  const token = match[2];

  // JWT tokens start with "eyJ" (base64url-encoded "{")
  if (token.startsWith("eyJ")) {
    return await resolveJwtSession(token, scheme, req);
  }

  return await resolveOpaqueSession(req, token, scheme);
}

async function resolveJwtSession(
  token: string,
  scheme: string,
  req: Request
): Promise<ResolvedAuthSession> {
  const payload = await verifyAccessToken(token);
  if (!payload?.sub) {
    return { session: null, authContext: null };
  }

  // Enforce DPoP proof-of-possession for DPoP-bound tokens
  const cnf = payload.cnf as { jkt?: string } | undefined;
  if (cnf?.jkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return { session: null, authContext: null };
    }
    try {
      const validDpop = await validateOpaqueAccessTokenDpop(req, cnf.jkt);
      if (!validDpop) {
        return { session: null, authContext: null };
      }
    } catch {
      return { session: null, authContext: null };
    }
  }

  const clientId =
    (payload.client_id as string | undefined) ??
    (payload.azp as string | undefined);
  const userId = clientId
    ? ((await resolveUserIdFromSub(payload.sub, clientId)) ?? payload.sub)
    : payload.sub;

  const sessionId = typeof payload.sid === "string" ? payload.sid : undefined;
  const authContextId =
    typeof payload[AUTHENTICATION_CONTEXT_CLAIM] === "string"
      ? (payload[AUTHENTICATION_CONTEXT_CLAIM] as string)
      : undefined;
  const authContext = await resolveAuthenticationContext({
    authContextId,
    sessionId,
  });

  if (sessionId) {
    const session = await loadPersistedSession(sessionId);
    if (!(session && authContext)) {
      return { session: null, authContext: null };
    }
    return { session, authContext };
  }

  if (!authContext) {
    return { session: null, authContext: null };
  }

  return {
    authContext,
    session: await buildSessionFromUserId(userId, {
      authContextId: authContext.id,
    }),
  };
}

async function resolveOpaqueSession(
  req: Request,
  token: string,
  scheme: string
): Promise<ResolvedAuthSession> {
  const accessToken = await loadOpaqueAccessToken(token);
  if (!accessToken?.userId || accessToken.expiresAt < new Date()) {
    return { session: null, authContext: null };
  }

  if (accessToken.dpopJkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return { session: null, authContext: null };
    }
    const validDpop = await validateOpaqueAccessTokenDpop(
      req,
      accessToken.dpopJkt
    );
    if (!validDpop) {
      return { session: null, authContext: null };
    }
  }

  const authContext = await resolveAuthenticationContext({
    authContextId: accessToken.authContextId,
    sessionId: accessToken.sessionId,
  });

  if (accessToken.sessionId) {
    const session = await loadPersistedSession(accessToken.sessionId);
    if (!(session && authContext)) {
      return { session: null, authContext: null };
    }
    return { session, authContext };
  }

  if (!authContext) {
    return { session: null, authContext: null };
  }

  return {
    authContext,
    session: await buildSessionFromUserId(accessToken.userId, {
      authContextId: authContext.id,
    }),
  };
}

/**
 * Resolve session from internal service token headers.
 * Used by trusted internal services (MCP HTTP transport) that have
 * already validated the caller's identity and pass the user ID directly.
 */
function resolveServiceTokenSession(
  req: Request
): Promise<ResolvedAuthSession> {
  const token = req.headers.get("x-zentity-internal-token");
  const userId = req.headers.get("x-zentity-user-id");

  if (!(token && userId && env.INTERNAL_SERVICE_TOKEN)) {
    return Promise.resolve({ session: null, authContext: null });
  }

  const expected = Buffer.from(env.INTERNAL_SERVICE_TOKEN);
  const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return Promise.resolve({ session: null, authContext: null });
  }

  return buildSessionFromUserId(userId).then((session) => ({
    session,
    authContext: null,
  }));
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
  resHeaders?: Headers;
}): Promise<TrpcContext> {
  const requestContext = resolveRequestContext(args.req.headers);
  let session: Session | null = null;
  let authContext: AuthenticationState | null = null;
  try {
    session = await auth.api.getSession({ headers: args.req.headers });
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
      authContext = resolved.authContext;
    } catch (error) {
      logError(error, {
        requestId: requestContext.requestId,
        path: "auth.resolveOAuth",
      });
    }
  }

  if (!session) {
    try {
      const resolved = await resolveServiceTokenSession(args.req);
      session = resolved.session;
      authContext = resolved.authContext;
    } catch (error) {
      logError(error, {
        requestId: requestContext.requestId,
        path: "auth.resolveServiceToken",
      });
    }
  }

  return {
    req: args.req,
    session: session ?? null,
    authContext,
    requestId: requestContext.requestId,
    flowId: requestContext.flowId,
    flowIdSource: requestContext.flowIdSource,
    resHeaders: args.resHeaders ?? new Headers(),
  };
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
    return shape;
  },
});

const withTracing = trpc.middleware(({ path, type, input, ctx, next }) => {
  const tracer = getTracer();
  const inputMeta = extractInputMeta(input);

  const attributes: SpanAttributes = {
    "rpc.system": "trpc",
    "rpc.method": path,
    "rpc.type": type,
    "request.id": ctx.requestId,
  };

  const flowAttributes = getSpanAttributesFromContext(ctx);
  for (const [key, value] of Object.entries(flowAttributes)) {
    if (value !== undefined) {
      attributes[key] = value;
    }
  }

  if (typeof inputMeta.inputSize === "number") {
    attributes["input.size"] = inputMeta.inputSize;
  }
  if (typeof inputMeta.hasImage === "boolean") {
    attributes["input.has_image"] = inputMeta.hasImage;
  }
  if (ctx.session?.session?.id) {
    attributes["session.id"] = hashIdentifier(ctx.session.session.id);
  }

  return tracer.startActiveSpan(
    `trpc.${path}`,
    { attributes },
    async (span) => {
      try {
        const spanContext = span.spanContext();
        const result = await next({
          ctx: {
            ...ctx,
            span,
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
          },
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "tRPC failed",
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
});

/**
 * Paths that should log at debug level only (high frequency, low value).
 */
const DEBUG_ONLY_PATHS = new Set([
  "zk.health",
  "zk.challengeStatus",
  "attestation.networks",
  "attestation.status",
  "signUp.getSession",
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
  "crypto.storeProof",
  "crypto.verifyProof",
  "compliantToken.mint",
  "account.deleteAccount",
  "liveness.verify",
]);

/**
 * Logging middleware - adds request correlation and structured logging.
 * Runs on all procedures, before authentication.
 * Adds log, requestId, and debug to context.
 */
const withLogging = trpc.middleware(
  async ({ ctx, next, path, type, input }) => {
    const requestId = ctx.requestId || randomUUID();
    const logBindings: Record<string, unknown> = {
      ...getRequestLogBindings(ctx),
    };
    if (ctx.traceId) {
      logBindings.traceId = ctx.traceId;
    }
    if (ctx.spanId) {
      logBindings.spanId = ctx.spanId;
    }
    const log = createRequestLogger(requestId, logBindings);
    const debug = isDebugEnabled();
    const start = performance.now();

    // Determine log level for this path
    const isDebugPath = DEBUG_ONLY_PATHS.has(path);
    const isCritical = CRITICAL_PATHS.has(path);

    // Log request start (metadata only, no input values)
    const inputMeta = extractInputMeta(input);
    if (isDebugPath) {
      log.debug({ path, type, ...inputMeta }, "tRPC request");
    } else {
      log.info({ path, type, ...inputMeta }, "tRPC request");
    }

    try {
      const result = await next({
        ctx: { ...ctx, log, requestId, debug },
      });

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
      // Handle TRPCError based on code
      if (error instanceof TRPCError) {
        // UNAUTHORIZED is expected, log at debug
        if (error.code === "UNAUTHORIZED") {
          log.debug({ path, code: error.code }, "Unauthorized");
          throw error;
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
          throw error;
        }

        // Server errors (INTERNAL_SERVER_ERROR, etc.) at error level
        const duration = Math.round(performance.now() - start);
        logError(error, { requestId, path, duration }, log);
        throw error;
      }

      // Unexpected errors always at error level with timing
      const duration = Math.round(performance.now() - start);
      logError(error, { requestId, path, duration }, log);
      throw error;
    }
  }
);

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
