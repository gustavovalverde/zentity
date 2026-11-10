/**
 * tRPC Client
 *
 * Browser-side tRPC clients for making type-safe API calls.
 *
 * @example Vanilla client (for event handlers, utilities):
 * ```ts
 * const result = await trpc.zk.health.query();
 * const proof = await trpc.zk.verifyProof.mutate({ proof, publicInputs });
 * ```
 *
 * @example React components (TanStack Query options):
 * ```ts
 * const trpc = useTRPC();
 * const { data } = useQuery(trpc.attestation.networks.queryOptions());
 * const mutation = useMutation(trpc.attestation.createPermit.mutationOptions());
 * ```
 */
"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc/routers/app";

import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";

import { getFlowId } from "@/lib/observability/flow-id";

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
      const flowId = getFlowId();
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
 * Type-safe tRPC client for browser use.
 * Call it directly from event handlers, utilities, and non-component code.
 * TrpcProvider hands the same instance to the TanStack Query integration.
 * Automatically includes credentials for session cookies.
 */
export const trpc = createTRPCClient<AppRouter>({
  links,
});

/**
 * TanStack Query integration for components: `useTRPC()` returns
 * `queryOptions`, `mutationOptions`, `queryKey`, and `queryFilter` factories
 * for TanStack's own hooks and QueryClient methods.
 */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/**
 * Inferred response type for any router procedure.
 * Use `RouterOutputs["identity"]["verify"]` to derive component props.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
