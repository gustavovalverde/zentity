import "server-only";

/**
 * Shared warmup state. Set by instrumentation.ts, read by /api/ready.
 * Module-scoped singleton — safe because instrumentation and request
 * handlers run in the same Node.js process.
 */
let ready = false;

export function markWarmupComplete(): void {
  ready = true;
}

export function isWarmupComplete(): boolean {
  return ready;
}
