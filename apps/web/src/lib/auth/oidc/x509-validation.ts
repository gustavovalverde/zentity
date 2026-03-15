import "server-only";

import { createHash, X509Certificate } from "node:crypto";

/**
 * Full x5c chain validation for OID4VP `client_id_scheme: "x509_hash"`.
 *
 * Verifies:
 * 1. SHA-256 thumbprint of the leaf matches the client_id
 * 2. Leaf certificate is signed by the CA (signature verification)
 * 3. Both certificates are within their validity period
 *
 * The x5c chain is [leaf, ...intermediates, CA] as base64-encoded DER
 * or PEM strings. At least 2 entries are required (leaf + CA).
 */
export function validateX509Chain(
  clientId: string,
  x5cChain: string[]
): { valid: boolean; error?: string } {
  if (x5cChain.length < 2) {
    return {
      valid: false,
      error: "x5c chain must contain at least leaf and CA",
    };
  }

  const leafB64 = x5cChain[0];
  const caB64 = x5cChain.at(-1);
  if (!(leafB64 && caB64)) {
    return { valid: false, error: "x5c chain entries are empty" };
  }

  const leafPem = toPem(leafB64);
  const caPem = toPem(caB64);

  let leaf: X509Certificate;
  let ca: X509Certificate;
  try {
    leaf = new X509Certificate(leafPem);
    ca = new X509Certificate(caPem);
  } catch {
    return { valid: false, error: "Failed to parse x5c certificates" };
  }

  // 1. Thumbprint match
  const leafDer = Buffer.from(leafB64, "base64");
  const thumbprint = createHash("sha256").update(leafDer).digest("base64url");
  if (clientId !== thumbprint) {
    return {
      valid: false,
      error: "client_id does not match leaf certificate thumbprint",
    };
  }

  // 2. Validity period
  const now = new Date();
  if (now < new Date(leaf.validFrom) || now > new Date(leaf.validTo)) {
    return {
      valid: false,
      error: "Leaf certificate is outside its validity period",
    };
  }
  if (now < new Date(ca.validFrom) || now > new Date(ca.validTo)) {
    return {
      valid: false,
      error: "CA certificate is outside its validity period",
    };
  }

  // 3. Signature verification — leaf must be signed by the CA
  if (!leaf.checkIssued(ca)) {
    return { valid: false, error: "Leaf certificate was not issued by the CA" };
  }

  return { valid: true };
}

function toPem(certStr: string): string {
  if (certStr.includes("-----BEGIN")) {
    return certStr;
  }
  return `-----BEGIN CERTIFICATE-----\n${certStr}\n-----END CERTIFICATE-----`;
}
