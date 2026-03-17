/**
 * tRPC Server Configuration
 *
 * Sets up the tRPC router infrastructure with authentication and logging middleware.
 * All tRPC routers use these base procedures to handle public and
 * authenticated requests consistently.
 */
import "server-only";

import type { FeatureName } from "@/lib/assurance/types";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { getAssuranceState } from "@/lib/assurance/data";
import { canAccessFeature, getBlockedReason } from "@/lib/assurance/features";
import { auth, type Session } from "@/lib/auth/auth";
import { db } from "@/lib/db/connection";
import { users } from "@/lib/db/schema/auth";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";
import { logError, logWarn } from "@/lib/logging/error-logger";
import { createRequestLogger, isDebugEnabled } from "@/lib/logging/logger";
import { extractInputMeta } from "@/lib/logging/redact";
import {
  getRequestLogBindings,
  getSpanAttributesFromContext,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import { getTracer, hashIdentifier } from "@/lib/observability/telemetry";
import { verifyAccessToken } from "@/lib/trpc/jwt-session";

type SpanAttributes = Record<string, string | number | boolean>;

/** Base context available to all procedures (public and protected). */
interface TrpcContext {
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

const dpopValidator = createDpopAccessTokenValidator({ requireDpop: false });

/**
 * Resolve a user from an OAuth access token (DPoP or Bearer).
 * Handles both JWT tokens (decode + sub lookup) and opaque tokens (hash lookup).
 * Validates DPoP proof-of-possession when the token is DPoP-bound (cnf.jkt).
 */
async function resolveOAuthSession(req: Request): Promise<Session | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(AUTH_HEADER_RE);
  if (!(match?.[1] && match[2])) {
    return null;
  }

  const scheme = match[1];
  const token = match[2];

  // JWT tokens start with "eyJ" (base64url-encoded "{")
  if (token.startsWith("eyJ")) {
    return await resolveJwtSession(token, scheme, req);
  }

  return await resolveOpaqueSession(token);
}

async function resolveJwtSession(
  token: string,
  scheme: string,
  req: Request
): Promise<Session | null> {
  const payload = await verifyAccessToken(token);
  if (!payload?.sub) {
    return null;
  }

  // Enforce DPoP proof-of-possession for DPoP-bound tokens
  const cnf = payload.cnf as { jkt?: string } | undefined;
  if (cnf?.jkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return null;
    }
    try {
      await dpopValidator({
        request: req,
        tokenPayload: payload as Record<string, unknown>,
      });
    } catch {
      return null;
    }
  }

  return await buildSessionFromUserId(payload.sub);
}

async function resolveOpaqueSession(token: string): Promise<Session | null> {
  const tokenHash = createHash("sha256").update(token).digest("base64url");

  const accessToken = await db
    .select({
      userId: oauthAccessTokens.userId,
      expiresAt: oauthAccessTokens.expiresAt,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, tokenHash))
    .limit(1)
    .get();

  if (!accessToken?.userId || accessToken.expiresAt < new Date()) {
    return null;
  }

  return buildSessionFromUserId(accessToken.userId);
}

/**
 * Resolve session from internal service token headers.
 * Used by trusted internal services (MCP HTTP transport) that have
 * already validated the caller's identity and pass the user ID directly.
 */
function resolveServiceTokenSession(req: Request): Promise<Session | null> {
  const token = req.headers.get("x-zentity-internal-token");
  const userId = req.headers.get("x-zentity-user-id");

  if (!(token && userId && env.INTERNAL_SERVICE_TOKEN)) {
    return Promise.resolve(null);
  }

  const expected = Buffer.from(env.INTERNAL_SERVICE_TOKEN);
  const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return Promise.resolve(null);
  }

  return buildSessionFromUserId(userId);
}

async function buildSessionFromUserId(userId: string): Promise<Session | null> {
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
      id: `oauth:${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      token: "",
      createdAt: new Date(),
      updatedAt: new Date(),
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
  try {
    session = await auth.api.getSession({ headers: args.req.headers });
  } catch (error) {
    logError(error, {
      requestId: requestContext.requestId,
      path: "auth.getSession",
    });
  }

  if (!session) {
    try {
      session = await resolveOAuthSession(args.req);
    } catch (error) {
      logError(error, {
        requestId: requestContext.requestId,
        path: "auth.resolveOAuth",
      });
    }
  }

  if (!session) {
    try {
      session = await resolveServiceTokenSession(args.req);
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
  "attestation.submit",
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
      userId: string;
      session: Session;
    };

    const assuranceState = await getAssuranceState(
      tierContext.userId,
      tierContext.session
    );

    if (
      !canAccessFeature(
        feature,
        assuranceState.tier,
        assuranceState.authStrength
      )
    ) {
      const reason = getBlockedReason(
        feature,
        assuranceState.tier,
        assuranceState.authStrength
      );
      throw new TRPCError({
        code: "FORBIDDEN",
        message: reason ?? `Feature "${feature}" is not accessible`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        assuranceState,
      },
    });
  });
}
