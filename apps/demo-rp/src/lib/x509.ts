import "server-only";

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PEM_HEADER = /-----BEGIN CERTIFICATE-----/g;
const PEM_FOOTER = /-----END CERTIFICATE-----/g;
const WHITESPACE = /\s/g;

function pemToDer(pem: string): Buffer {
  const base64 = pem
    .replace(PEM_HEADER, "")
    .replace(PEM_FOOTER, "")
    .replace(WHITESPACE, "");
  return Buffer.from(base64, "base64");
}

function decodeEnvPem(envValue: string | undefined): string | null {
  if (!envValue) return null;
  return Buffer.from(envValue, "base64").toString("utf8");
}

/**
 * Computes SHA-256 hash of a PEM certificate's DER encoding.
 */
export function computeCertHash(pem: string): string {
  return createHash("sha256").update(pemToDer(pem)).digest("base64url");
}

/**
 * Returns the `x509_hash#<hash>` client_id for a PEM certificate.
 */
export function getVerifierClientId(leafPem: string): string {
  return `x509_hash#${computeCertHash(leafPem)}`;
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

  if (!(leafPem && caPem)) return null;
  return [pemToBase64Der(leafPem), pemToBase64Der(caPem)];
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
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/**
 * Converts PEM to base64-DER (x5c format — no headers, no whitespace).
 */
function pemToBase64Der(pem: string): string {
  return pem
    .replace(PEM_HEADER, "")
    .replace(PEM_FOOTER, "")
    .replace(WHITESPACE, "");
}

/**
 * Extracts the Authority Key Identifier (AKI) from a PEM certificate.
 * Returns base64url-encoded AKI, or null if not present.
 */
export function extractAki(pem: string): string | null {
  const der = pemToDer(pem);
  // OID 2.5.29.35 (authorityKeyIdentifier) in DER: 06 03 55 1d 23
  const akiOid = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x23]);
  const idx = der.indexOf(akiOid);
  if (idx === -1) {
    return null;
  }

  let pos = idx + akiOid.length;

  // Skip BOOLEAN (critical flag) if present
  if (pos < der.length && der[pos] === 0x01) {
    pos += 3;
  }

  // OCTET STRING wrapper
  if (pos >= der.length || der[pos] !== 0x04) {
    return null;
  }
  pos += 1;
  const octetLen = readDerLength(der, pos);
  if (!octetLen) {
    return null;
  }
  pos = octetLen.nextPos;

  // SEQUENCE
  if (pos >= der.length || der[pos] !== 0x30) {
    return null;
  }
  pos += 1;
  const seqLen = readDerLength(der, pos);
  if (!seqLen) {
    return null;
  }
  pos = seqLen.nextPos;

  // Context-tagged [0] (0x80) — keyIdentifier
  if (pos >= der.length || der[pos] !== 0x80) {
    return null;
  }
  pos += 1;
  const kiLen = readDerLength(der, pos);
  if (!kiLen) {
    return null;
  }
  pos = kiLen.nextPos;

  const keyId = der.subarray(pos, pos + kiLen.length);
  return Buffer.from(keyId).toString("base64url");
}

function readDerLength(
  buf: Buffer,
  pos: number
): { length: number; nextPos: number } | null {
  if (pos >= buf.length) {
    return null;
  }
  const first = buf[pos];
  if (first < 0x80) {
    return { length: first, nextPos: pos + 1 };
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: DER encoding uses bitwise ops
  const numBytes = first & 0x7f;
  if (numBytes === 0 || pos + 1 + numBytes > buf.length) {
    return null;
  }
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: DER multi-byte length parsing
    length = (length << 8) | buf[pos + 1 + i];
  }
  return { length, nextPos: pos + 1 + numBytes };
}
