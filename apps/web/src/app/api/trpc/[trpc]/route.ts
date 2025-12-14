/**
 * tRPC API Route Handler
 *
 * Next.js catch-all route that forwards all /api/trpc/* requests
 * to the tRPC router. Uses the Fetch API adapter for edge compatibility
 * but explicitly runs on Node.js runtime for Human.js/tfjs-node support.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/trpc/routers/app";
import { createTrpcContext } from "@/lib/trpc/server";

// Node.js runtime required for server-side face detection (tfjs-node).
export const runtime = "nodejs";

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => createTrpcContext({ req }),
  });
}

export { handler as GET, handler as POST };
