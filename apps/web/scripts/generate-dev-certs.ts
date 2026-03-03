#!/usr/bin/env tsx

/**
 * Generates self-signed X.509 certificates for HAIP x5c trust chain headers.
 *
 * Creates a CA + leaf certificate using ES256 (P-256) for dev/test.
 * Production should use real PKI certificates.
 *
 * Output: .data/certs/ca.pem, .data/certs/leaf.pem, .data/certs/leaf-key.pem
 *
 * Usage: pnpm exec tsx scripts/generate-dev-certs.ts
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CERT_DIR = resolve(ROOT, ".data", "certs");

if (
  existsSync(resolve(CERT_DIR, "ca.pem")) &&
  existsSync(resolve(CERT_DIR, "leaf.pem"))
) {
  console.log("Certificates already exist at .data/certs/ — skipping.");
  process.exit(0);
}

mkdirSync(CERT_DIR, { recursive: true });

const caKeyPath = resolve(CERT_DIR, "ca-key.pem");
const caCertPath = resolve(CERT_DIR, "ca.pem");
const leafKeyPath = resolve(CERT_DIR, "leaf-key.pem");
const leafCsrPath = resolve(CERT_DIR, "leaf.csr");
const leafCertPath = resolve(CERT_DIR, "leaf.pem");

const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: CERT_DIR, stdio: "pipe" });

console.log("Generating dev CA key...");
run("openssl", [
  "ecparam",
  "-genkey",
  "-name",
  "prime256v1",
  "-noout",
  "-out",
  caKeyPath,
]);

console.log("Generating dev CA certificate...");
run("openssl", [
  "req",
  "-new",
  "-x509",
  "-key",
  caKeyPath,
  "-out",
  caCertPath,
  "-days",
  "3650",
  "-subj",
  "/CN=Zentity Dev CA/O=Zentity/C=US",
]);

console.log("Generating leaf key...");
run("openssl", [
  "ecparam",
  "-genkey",
  "-name",
  "prime256v1",
  "-noout",
  "-out",
  leafKeyPath,
]);

console.log("Generating leaf CSR...");
run("openssl", [
  "req",
  "-new",
  "-key",
  leafKeyPath,
  "-out",
  leafCsrPath,
  "-subj",
  "/CN=Zentity Dev Issuer/O=Zentity/C=US",
]);

console.log("Signing leaf certificate with CA...");
run("openssl", [
  "x509",
  "-req",
  "-in",
  leafCsrPath,
  "-CA",
  caCertPath,
  "-CAkey",
  caKeyPath,
  "-CAcreateserial",
  "-out",
  leafCertPath,
  "-days",
  "365",
]);

// Verify chain
console.log("Verifying certificate chain...");
run("openssl", ["verify", "-CAfile", caCertPath, leafCertPath]);

// Print summary
const leaf = readFileSync(leafCertPath, "utf8");
const ca = readFileSync(caCertPath, "utf8");
console.log(
  `\nDev certificates generated:\n  CA:   ${caCertPath} (${ca.length} bytes)\n  Leaf: ${leafCertPath} (${leaf.length} bytes)`
);
console.log("\nThese are self-signed dev certs. Use real PKI for production.");
