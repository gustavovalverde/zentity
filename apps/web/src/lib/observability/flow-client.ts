"use client";

const FLOW_STORAGE_KEY = "zentity.onboarding.flow";

let cachedFlowId: string | null = null;

export function setOnboardingFlowId(flowId: string | null): void {
  cachedFlowId = flowId;
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (flowId) {
      window.sessionStorage.setItem(FLOW_STORAGE_KEY, flowId);
    } else {
      window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
    }
  } catch {
    // Storage is best-effort; ignore failures.
  }
}

export function getOnboardingFlowId(): string | null {
  if (cachedFlowId) {
    return cachedFlowId;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.sessionStorage.getItem(FLOW_STORAGE_KEY);
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
 * Clear the onboarding flow ID cache.
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
export function resetOnboardingFlowId(): void {
  setOnboardingFlowId(null);
}
