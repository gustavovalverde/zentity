import "server-only";

import { createHash } from "node:crypto";

/**
 * Validates that a client_id matches the SHA-256 thumbprint of the leaf
 * certificate in an x5c chain (base64-encoded DER certificates).
 *
 * Used for OID4VP `client_id_scheme: "x509_hash"` — ensures the verifier's
 * client_id is the certificate thumbprint, preventing session tampering.
 */
export function validateX509Hash(
  clientId: string,
  x5cChain: string[]
): boolean {
  if (!x5cChain.length) {
    return false;
  }

  const leafDer = Buffer.from(x5cChain[0], "base64");
  const thumbprint = createHash("sha256").update(leafDer).digest("base64url");

  return clientId === thumbprint;
}
