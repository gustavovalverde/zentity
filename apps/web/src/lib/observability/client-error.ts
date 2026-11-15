"use client";

import { getFlowId } from "@/lib/observability/flow-id";

/**
 * Fire-and-forget report of an error caught by a Next.js error boundary.
 * Next has no client-side reporting hook, and `global-error` renders outside
 * the app providers, so this must stay free of provider dependencies.
 */
export function reportClientError(
  error: Error & { digest?: string },
  source?: string
): void {
  const flowId = getFlowId();
  fetch("/api/status/log-client-error", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(flowId ? { "X-Zentity-Flow-Id": flowId } : {}),
    },
    body: JSON.stringify({
      name: error.name,
      message: error.message,
      digest: error.digest,
      path: globalThis.window?.location?.pathname,
      stack: error.stack,
      source,
    }),
  }).catch(() => {
    // Logging failure should not cascade to the user.
  });
}
