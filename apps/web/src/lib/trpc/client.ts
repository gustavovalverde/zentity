/**
 * tRPC Client
 *
 * Browser-side tRPC proxy client for making type-safe API calls.
 * Uses httpBatchLink to batch multiple requests into a single HTTP call.
 *
 * @example
 * ```ts
 * const result = await trpc.crypto.health.query();
 * const proof = await trpc.crypto.verifyProof.mutate({ proof, publicInputs, circuitType });
 * ```
 */
"use client";

import type { AppRouter } from "@/lib/trpc/routers/app";

import { createTRPCProxyClient, httpBatchLink, loggerLink } from "@trpc/client";

function getTrpcUrl(): string {
  // Same-origin requests to avoid CORS; routed via Next.js API handler.
  return "/api/trpc";
}

/**
 * Type-safe tRPC client for browser use.
 * Automatically includes credentials for session cookies.
 */
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    // Logs requests in dev mode or errors in production for debugging.
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
    }),
    httpBatchLink({
      url: getTrpcUrl(),
      fetch(url, options) {
        // Include credentials so session cookies are sent with requests.
        return globalThis.fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});
