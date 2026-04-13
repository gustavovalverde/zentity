import "server-only";

import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// ── x5c chain loading ────────────────────────────────────

const CERT_DIR = resolve(process.cwd(), ".data", "certs");

/**
 * Loads the x5c certificate chain (leaf first, CA last).
 * Tries env vars first (X5C_LEAF_PEM, X5C_CA_PEM), falls back to filesystem.
 * Returns null if certificates aren't available.
 */
export function loadX5cChain(): string[] | null {
  const leafEnv = process.env.X5C_LEAF_PEM;
  const caEnv = process.env.X5C_CA_PEM;

  if (leafEnv && caEnv) {
    return [
      normalizeX5cEntry(Buffer.from(leafEnv, "base64").toString("utf8")),
      normalizeX5cEntry(Buffer.from(caEnv, "base64").toString("utf8")),
    ];
  }

  const leafPath = resolve(CERT_DIR, "leaf.pem");
  const caPath = resolve(CERT_DIR, "ca.pem");

  if (!(existsSync(leafPath) && existsSync(caPath))) {
    return null;
  }

  return [
    normalizeX5cEntry(readFileSync(leafPath, "utf8")),
    normalizeX5cEntry(readFileSync(caPath, "utf8")),
  ];
}

function normalizeX5cEntry(cert: string): string {
  if (cert.includes("-----BEGIN")) {
    return cert
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
  }
  return cert.replace(/\s+/g, "");
}
