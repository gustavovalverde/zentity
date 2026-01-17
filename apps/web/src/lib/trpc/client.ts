/**
 * tRPC Client
 *
 * Browser-side tRPC clients for making type-safe API calls.
 *
 * @example Vanilla client (for event handlers, utilities):
 * ```ts
 * const result = await trpc.crypto.health.query();
 * const proof = await trpc.crypto.verifyProof.mutate({ proof, publicInputs });
 * ```
 *
 * @example React hooks (for components with useQuery/useMutation):
 * ```ts
 * const { data } = trpcReact.attestation.networks.useQuery();
 * const mutation = trpcReact.attestation.submit.useMutation();
 * ```
 */
"use client";

import type { AppRouter } from "@/lib/trpc/routers/app";

import { createTRPCProxyClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";

import { getOnboardingFlowId } from "@/lib/observability/flow-client";

type LogMeta = Record<string, string | number | boolean>;

function getTrpcUrl(): string {
  // Same-origin requests to avoid CORS; routed via Next.js API handler.
  return "/api/trpc";
}

const TRPC_REQUEST_TIMEOUT_MS = 60_000;

function createTimeoutSignal(original: AbortSignal | null | undefined) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    TRPC_REQUEST_TIMEOUT_MS
  );

  if (original) {
    if (original.aborted) {
      controller.abort();
    } else {
      original.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Common links configuration for both clients.
 */
const links = [
  // Logs requests in dev mode or errors in production for debugging.
  loggerLink({
    enabled: (opts) =>
      process.env.NODE_ENV === "development" ||
      (opts.direction === "down" && opts.result instanceof Error),
    logger(opts) {
      const dir = opts.direction === "up" ? ">>" : "<<";
      const elapsed =
        opts.direction === "down" && typeof opts.elapsedMs === "number"
          ? ` (${opts.elapsedMs}ms)`
          : "";
      const errorName =
        opts.direction === "down" && opts.result instanceof Error
          ? opts.result.name
          : undefined;
      const meta: LogMeta = {
        direction: opts.direction,
      };
      if (errorName) {
        meta.error = true;
        meta.errorName = errorName;
      }
      console.log(`[trpc] ${dir} ${opts.type} ${opts.path}${elapsed}`, meta);
    },
  }),
  httpBatchLink({
    url: getTrpcUrl(),
    fetch(url, options) {
      // Include credentials so session cookies are sent with requests.
      const { signal, cleanup } = createTimeoutSignal(options?.signal);
      const flowId = getOnboardingFlowId();
      const headers = new Headers(options?.headers ?? {});
      if (flowId) {
        headers.set("X-Zentity-Flow-Id", flowId);
      }
      return globalThis
        .fetch(url, {
          ...options,
          headers,
          credentials: "include",
          signal,
        })
        .finally(cleanup);
    },
  }),
];

/**
 * Type-safe tRPC client for browser use (vanilla - no React Query).
 * Use this for event handlers, utilities, and non-component code.
 * Automatically includes credentials for session cookies.
 */
export const trpc = createTRPCProxyClient<AppRouter>({
  links,
});

/**
 * React Query-integrated tRPC client for use in components.
 * Provides useQuery, useMutation hooks with caching and suspense support.
 */
export const trpcReact = createTRPCReact<AppRouter>();

/**
 * Get the tRPC client configuration for the TRPCProvider.
 */
export function getTrpcClientConfig() {
  return {
    links,
  };
}
