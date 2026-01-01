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

async function handler(req: Request) {
  // Create response headers container for procedures to set cookies
  const resHeaders = new Headers();

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => createTrpcContext({ req, resHeaders }),
  });

  // Check if any cookies need to be set
  const hasCookies = resHeaders.has("Set-Cookie");

  if (!hasCookies) {
    return response;
  }

  // Read the response body to avoid stream issues
  const body = await response.text();

  // Create merged headers with cookies
  const mergedHeaders = new Headers(response.headers);
  resHeaders.forEach((value, key) => {
    mergedHeaders.append(key, value);
  });

  // Return a new Response with the body as text and merged headers
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: mergedHeaders,
  });
}

export { handler as GET, handler as POST };
