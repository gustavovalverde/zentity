/**
 * tRPC Server Configuration
 *
 * Sets up the tRPC router infrastructure with authentication middleware.
 * All tRPC routers use these base procedures to handle public and
 * authenticated requests consistently.
 */
import "server-only";

import { initTRPC, TRPCError } from "@trpc/server";

import { auth, type Session } from "@/lib/auth/auth";

/** Base context available to all procedures (public and protected). */
type TrpcContext = {
  req: Request;
  session: Session | null;
};

/** Extended context for authenticated procedures with guaranteed user ID. */
type TrpcAuthedContext = TrpcContext & {
  session: Session;
  userId: string;
};

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

  return { req: args.req, session: session ?? null };
}

const trpc = initTRPC.context<TrpcContext>().create();

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
    ctx: { ...ctx, session, userId } satisfies TrpcAuthedContext,
  });
});

export const router = trpc.router;
/** Procedure for unauthenticated endpoints (e.g., health checks). */
export const publicProcedure = trpc.procedure;
/** Procedure requiring authentication; ctx includes userId. */
export const protectedProcedure = trpc.procedure.use(enforceAuth);
