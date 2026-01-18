"use client";

const FLOW_STORAGE_KEY = "zentity.flow";

let cachedFlowId: string | null = null;

export function setFlowId(flowId: string | null): void {
  cachedFlowId = flowId;
  if (globalThis.window === undefined) {
    return;
  }
  try {
    if (flowId) {
      globalThis.window.sessionStorage.setItem(FLOW_STORAGE_KEY, flowId);
    } else {
      globalThis.window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
    }
  } catch {
    // Storage is best-effort; ignore failures.
  }
}

export function getFlowId(): string | null {
  if (cachedFlowId) {
    return cachedFlowId;
  }
  if (globalThis.window === undefined) {
    return null;
  }
  try {
    const stored = globalThis.window.sessionStorage.getItem(FLOW_STORAGE_KEY);
    if (stored) {
      cachedFlowId = stored;
      return stored;
    }
  } catch {
    // Ignore storage failures.
  }
  return null;
}

/**
 * Clear the flow ID cache.
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
export function resetFlowId(): void {
  setFlowId(null);
}
