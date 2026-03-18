#!/usr/bin/env tsx

/**
 * Zero-config dev environment setup.
 *
 * Generates cryptographic secrets and writes .env from .env.example.
 * Safe to re-run — skips if .env already exists.
 *
 * Usage: pnpm setup
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, ".env");
const EXAMPLE_PATH = resolve(ROOT, ".env.example");

function randomBase64(bytes: number): string {
  return execFileSync("openssl", ["rand", "-base64", String(bytes)], {
    encoding: "utf8",
  }).trim();
}

function randomHex(bytes: number): string {
  return execFileSync("openssl", ["rand", "-hex", String(bytes)], {
    encoding: "utf8",
  }).trim();
}

function generateOpaqueSetup(): {
  serverSetup: string;
  publicKey: string;
} {
  // npx needs a shell to resolve the package
  const serverSetup = execSync(
    "npx --yes @serenity-kit/opaque@latest create-server-setup",
    { encoding: "utf8" }
  ).trim();

  const publicKey = execSync(
    "npx --yes @serenity-kit/opaque@latest get-server-public-key",
    { encoding: "utf8", input: serverSetup }
  ).trim();

  return { serverSetup, publicKey };
}

if (existsSync(ENV_PATH)) {
  console.log(".env already exists — skipping generation.");
  console.log("  Delete .env and re-run to regenerate secrets.");
  process.exit(0);
}

if (!existsSync(EXAMPLE_PATH)) {
  console.error(".env.example not found at", EXAMPLE_PATH);
  process.exit(1);
}

console.log("Generating cryptographic secrets...\n");

const betterAuthSecret = randomBase64(32);
const internalServiceToken = randomBase64(32);
const bbsIssuerSecret = randomHex(32);
const pairwiseSecret = randomHex(32);
const dedupHmacSecret = randomHex(32);
const claimSigningSecret = randomHex(32);
const ciphertextHmacSecret = randomHex(32);

console.log("  BETTER_AUTH_SECRET       done");
console.log("  INTERNAL_SERVICE_TOKEN   done");
console.log("  BBS_ISSUER_SECRET        done");
console.log("  DEDUP_HMAC_SECRET        done");
console.log("  PAIRWISE_SECRET          done");
console.log("  CLAIM_SIGNING_SECRET     done");
console.log("  CIPHERTEXT_HMAC_SECRET   done");

console.log("  OPAQUE_SERVER_SETUP      generating...");
const { serverSetup, publicKey } = generateOpaqueSetup();
console.log("  OPAQUE_SERVER_SETUP      done");
console.log("  OPAQUE public key        done");

console.log("  VAPID keys               generating...");
const vapidKeysJson = execSync(
  "npx --yes web-push generate-vapid-keys --json",
  { encoding: "utf8" }
).trim();
const vapidKeys = JSON.parse(vapidKeysJson) as {
  publicKey: string;
  privateKey: string;
};
console.log("  VAPID keys               done\n");

let template = readFileSync(EXAMPLE_PATH, "utf8");

const replacements: Record<string, string> = {
  BETTER_AUTH_SECRET: betterAuthSecret,
  OPAQUE_SERVER_SETUP: serverSetup,
  NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY: publicKey,
  INTERNAL_SERVICE_TOKEN: internalServiceToken,
  BBS_ISSUER_SECRET: bbsIssuerSecret,
  DEDUP_HMAC_SECRET: dedupHmacSecret,
  PAIRWISE_SECRET: pairwiseSecret,
  CLAIM_SIGNING_SECRET: claimSigningSecret,
  CIPHERTEXT_HMAC_SECRET: ciphertextHmacSecret,
  VAPID_PUBLIC_KEY: vapidKeys.publicKey,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidKeys.publicKey,
  VAPID_PRIVATE_KEY: vapidKeys.privateKey,
};

for (const [key, value] of Object.entries(replacements)) {
  const pattern = new RegExp(`^(${key})=.*$`, "m");
  template = template.replace(pattern, `$1=${value}`);
}

writeFileSync(ENV_PATH, template, "utf8");
console.log(".env written with generated secrets.");

console.log("\nPushing database schema...");
try {
  execSync("pnpm db:push:dev", { cwd: ROOT, stdio: "inherit" });
  console.log("Database schema pushed.");

  // Default all clients without a subject_type to pairwise (ARCOM double anonymity)
  execFileSync("sqlite3", [
    resolve(ROOT, ".data/dev.db"),
    "UPDATE oauth_client SET subject_type = 'pairwise' WHERE subject_type IS NULL;",
  ]);
  console.log("Backfilled oauth_client.subject_type to pairwise.\n");
} catch {
  console.warn(
    "Database push failed — you can run `pnpm db:push:dev` manually.\n"
  );
}

console.log("Setup complete! Run `pnpm dev` to start the dev server.");
