import { getFlowId } from "@/lib/observability/flow-id";

/**
 * Codebase convention for handling promises in void-return positions.
 *
 * The TypeScript-canonical fix for `no-floating-promises` is `void asyncFn()`.
 * It silences the linter but does NOT attach an error handler — rejections
 * become silent in production. We banned `void` codebase-wide and use this
 * pair instead:
 *
 *   asyncHandler(fn)        - wraps an async fn for JSX event-handler positions
 *   .catch(reportRejection) - attaches to a non-handler call site
 *
 * Both route rejections to `/api/status/log-client-error` (the same endpoint
 * Next.js error boundaries use). Inner handlers should still do their own
 * try/catch + user-facing error UI (toast, banner) — this is the safety net
 * for unexpected rejections that escape.
 *
 * For new async UI work that needs loading/error state, prefer TanStack
 * Query's `useMutation`. Use this pair for one-shot fire-and-forget actions
 * (clipboard, navigation, cache invalidation) where mutation overhead isn't
 * justified.
 */

/**
 * Wrap an async function for use in React event handlers (or anywhere a
 * void-return is required by the type system).
 *
 * @example
 *   <Button onClick={asyncHandler(handleSubmit)} />
 *   <Button onClick={asyncHandler(() => handleRemove(item.id))} />
 *   <form onSubmit={asyncHandler(handleSubmit)} />
 */
export function asyncHandler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<unknown>
): (...args: Args) => void {
  return (...args) => {
    fn(...args).catch(reportRejection);
  };
}

/**
 * Standalone rejection reporter for use as a `.catch()` argument in non-JSX
 * fire-and-forget calls (useEffect, polling loops, TTS, etc).
 *
 *   useEffect(() => {
 *     loadStuff().catch(reportRejection);
 *   }, []);
 */
export function reportRejection(error: unknown): void {
  if (typeof globalThis.window === "undefined") {
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const payload = {
    name: err.name,
    message: err.message,
    stack: err.stack,
    path: globalThis.window.location.pathname,
    source: "async-handler",
  };

  const flowId = getFlowId();
  fetch("/api/status/log-client-error", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(flowId ? { "X-Zentity-Flow-Id": flowId } : {}),
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Logging failure shouldn't cascade — fall back to console for dev visibility.
    console.error("async-handler: failed to report rejection", error);
  });
}
