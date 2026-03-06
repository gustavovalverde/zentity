#!/usr/bin/env tsx

/**
 * Generates self-signed X.509 certificates for the demo-rp verifier identity.
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

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
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

console.log("Generating verifier CA key...");
run("openssl", [
  "ecparam",
  "-genkey",
  "-name",
  "prime256v1",
  "-noout",
  "-out",
  caKeyPath,
]);

console.log("Generating verifier CA certificate...");
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
  "/CN=Demo-RP Verifier CA/O=Zentity Demo/C=US",
]);

console.log("Generating verifier leaf key (PKCS#8)...");
run("openssl", [
  "genpkey",
  "-algorithm",
  "EC",
  "-pkeyopt",
  "ec_paramgen_curve:prime256v1",
  "-out",
  leafKeyPath,
]);

console.log("Generating verifier leaf CSR...");
run("openssl", [
  "req",
  "-new",
  "-key",
  leafKeyPath,
  "-out",
  leafCsrPath,
  "-subj",
  "/CN=Demo-RP Verifier/O=Zentity Demo/C=US",
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

console.log("Verifying certificate chain...");
run("openssl", ["verify", "-CAfile", caCertPath, leafCertPath]);

const leaf = readFileSync(leafCertPath, "utf8");
const ca = readFileSync(caCertPath, "utf8");
console.log(
  `\nVerifier dev certificates generated:\n  CA:   ${caCertPath} (${ca.length} bytes)\n  Leaf: ${leafCertPath} (${leaf.length} bytes)`
);
console.log("\nThese are self-signed dev certs. Use real PKI for production.");
