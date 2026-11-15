import "server-only";

import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function decodeEnvPem(envValue: string | undefined): string | null {
  if (!envValue) {
    return null;
  }
  return Buffer.from(envValue, "base64").toString("utf8");
}

/**
 * Returns the `x509_hash:<hash>` Client Identifier for a PEM certificate
 * (OpenID4VP 1.0 §5.9.3): the base64url SHA-256 of its DER encoding.
 */
export function getVerifierClientId(leafPem: string): string {
  const der = new X509Certificate(leafPem).raw;
  return `x509_hash:${createHash("sha256").update(der).digest("base64url")}`;
}

/**
 * Loads PEM certificates and returns them as x5c entries (base64-DER).
 * Tries env vars first (VERIFIER_LEAF_PEM, VERIFIER_CA_PEM), falls back to filesystem.
 */
export function loadCertChain(certDir: string): string[] | null {
  const leafPem = loadLeafPem(certDir);
  const caPem =
    decodeEnvPem(process.env.VERIFIER_CA_PEM) ??
    readFileSafe(resolve(certDir, "ca.pem"));

  if (!(leafPem && caPem)) {
    return null;
  }
  return [leafPem, caPem].map((pem) =>
    new X509Certificate(pem).raw.toString("base64")
  );
}

/**
 * Loads the leaf certificate PEM.
 * Tries VERIFIER_LEAF_PEM env var first, falls back to filesystem.
 */
export function loadLeafPem(certDir: string): string | null {
  return (
    decodeEnvPem(process.env.VERIFIER_LEAF_PEM) ??
    readFileSafe(resolve(certDir, "leaf.pem"))
  );
}

/**
 * Loads the leaf private key PEM.
 * Tries VERIFIER_LEAF_KEY_PEM env var first, falls back to filesystem.
 */
export function loadLeafKeyPem(certDir: string): string | null {
  return (
    decodeEnvPem(process.env.VERIFIER_LEAF_KEY_PEM) ??
    readFileSafe(resolve(certDir, "leaf-key.pem"))
  );
}

function readFileSafe(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}
