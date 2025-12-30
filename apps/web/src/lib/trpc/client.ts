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

function getTrpcUrl(): string {
  // Same-origin requests to avoid CORS; routed via Next.js API handler.
  return "/api/trpc";
}

const TRPC_REQUEST_TIMEOUT_MS = 60_000;

const REDACT_KEYS = new Set([
  // Common image payload keys used across the app
  "image",
  "documentImage",
  "selfieImage",
  "baselineImage",
  "frameData",
  "idImage",
  // Passkey-wrapped secret payloads
  "encryptedBlob",
  "wrappedDek",
  "prfSalt",
  "credentialId",
]);

function sanitizeForLog(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>,
): unknown {
  if (depth > 4) return "[depth]";

  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return `<data:image redacted (${value.length} chars)>`;
    }
    if (value.length > 500) {
      return `<string redacted (${value.length} chars)>`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items: unknown[] = value
      .slice(0, 20)
      .map((v) => sanitizeForLog(v, depth + 1, seen));
    if (value.length > 20) items.push(`<… +${value.length - 20} more>`);
    return items;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const set = seen ?? new WeakSet<object>();
    if (set.has(obj)) return "[circular]";
    set.add(obj);

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = REDACT_KEYS.has(key)
        ? "<redacted>"
        : sanitizeForLog(val, depth + 1, set);
    }
    return out;
  }

  return value;
}

function createTimeoutSignal(original: AbortSignal | null | undefined) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    TRPC_REQUEST_TIMEOUT_MS,
  );

  if (original) {
    if (original.aborted) controller.abort();
    else
      original.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
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

      if (opts.direction === "up") {
        // biome-ignore lint/suspicious/noConsole: dev logging
        console.log(
          `[trpc] ${dir} ${opts.type} ${opts.path}`,
          sanitizeForLog(opts.input),
        );
        return;
      }

      const elapsed =
        typeof opts.elapsedMs === "number" ? ` (${opts.elapsedMs}ms)` : "";
      // biome-ignore lint/suspicious/noConsole: dev logging
      console.log(
        `[trpc] ${dir} ${opts.type} ${opts.path}${elapsed}`,
        sanitizeForLog(opts.result),
      );
    },
  }),
  httpBatchLink({
    url: getTrpcUrl(),
    fetch(url, options) {
      // Include credentials so session cookies are sent with requests.
      const { signal, cleanup } = createTimeoutSignal(options?.signal);
      return globalThis
        .fetch(url, { ...options, credentials: "include", signal })
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
