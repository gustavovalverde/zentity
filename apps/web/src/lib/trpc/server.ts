/**
 * tRPC Server Configuration
 *
 * Sets up the tRPC router infrastructure with authentication and logging middleware.
 * All tRPC routers use these base procedures to handle public and
 * authenticated requests consistently.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { initTRPC, TRPCError } from "@trpc/server";

import { auth, type Session } from "@/lib/auth/auth";
import {
  createRequestLogger,
  extractInputMeta,
  isDebugEnabled,
  type Logger,
  logError,
  logWarn,
} from "@/lib/logging";

/** Base context available to all procedures (public and protected). */
type TrpcContext = {
  req: Request;
  session: Session | null;
  requestId: string;
};

export type { Logger };

/**
 * Creates the tRPC context from an incoming request.
 * Extracts the user session from cookies via better-auth.
 */
export async function createTrpcContext(args: {
  req: Request;
}): Promise<TrpcContext> {
  const session = await auth.api.getSession({
    headers: args.req.headers,
  });
  const headerRequestId =
    args.req.headers.get("x-request-id") ||
    args.req.headers.get("x-correlation-id");

  return {
    req: args.req,
    session: session ?? null,
    requestId: headerRequestId || randomUUID(),
  };
}

const trpc = initTRPC.context<TrpcContext>().create();

/**
 * Paths that should log at debug level only (high frequency, low value).
 */
const DEBUG_ONLY_PATHS = new Set([
  "crypto.health",
  "crypto.challengeStatus",
  "attestation.networks",
  "attestation.status",
  "onboarding.getSession",
  "identity.status",
  "token.networks",
]);

/**
 * Critical paths that always log at info level.
 * These get timing logged in debug mode.
 */
const CRITICAL_PATHS = new Set([
  "identity.verify",
  "identity.processDocument",
  "attestation.submit",
  "crypto.storeProof",
  "crypto.verifyProof",
  "token.mint",
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
    const log = createRequestLogger(requestId);
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
      } else if (!isDebugPath) {
        log.info({ path, ok: true }, "tRPC complete");
      } else {
        log.debug({ path, ok: true }, "tRPC complete");
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
  },
);

/**
 * Authentication middleware that rejects unauthenticated requests.
 * Extracts userId from session and adds it to context for downstream use.
 */
const enforceAuth = trpc.middleware(({ ctx, next }) => {
  const session = ctx.session;
  const userId = session?.user?.id;
  if (!session || !userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: { ...ctx, session, userId },
  });
});

export const router = trpc.router;

/** Procedure for unauthenticated endpoints. Includes logging context. */
export const publicProcedure = trpc.procedure.use(withLogging);

/** Procedure requiring authentication. Includes logging context and userId. */
export const protectedProcedure = trpc.procedure
  .use(withLogging)
  .use(enforceAuth);
