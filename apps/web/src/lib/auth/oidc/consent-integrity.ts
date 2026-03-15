import { createHmac } from "node:crypto";

import { encodeAad } from "@/lib/privacy/primitives/aad";

const CONSENT_HMAC_CONTEXT = "zentity-consent-scope";

/**
 * Compute HMAC-SHA256 over consent record fields to detect scope tampering.
 *
 * Uses length-prefixed encoding (via encodeAad) to prevent concatenation
 * collisions between fields (e.g. clientId="ab" + userId="cd" vs "abc"+"d").
 *
 * Scopes are sorted before encoding so insertion order doesn't affect the tag.
 */
export function computeConsentHmac(
  secret: string,
  userId: string,
  clientId: string,
  referenceId: string | null,
  scopes: string[]
): string {
  const sortedScopes = [...scopes].sort().join(" ");
  const aad = encodeAad([
    CONSENT_HMAC_CONTEXT,
    userId,
    clientId,
    referenceId ?? "",
    sortedScopes,
  ]);
  return createHmac("sha256", secret).update(aad).digest("hex");
}
