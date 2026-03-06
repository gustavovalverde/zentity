import "server-only";

import { createDcqlMatcher } from "@better-auth/haip";

/**
 * Wraps `createDcqlMatcher()` with `trusted_authorities` awareness.
 *
 * AKI-based trusted_authorities filtering is primarily enforced at the
 * Verifier (demo-rp) which constructs the DCQL query. This wrapper ensures
 * forward compatibility when Zentity acts as a wallet receiving VP requests
 * from external verifiers.
 */
export function createTrustedDcqlMatcher() {
  return createDcqlMatcher();
}
