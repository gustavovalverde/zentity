#!/usr/bin/env tsx

/**
 * Zero-config dev environment setup.
 *
 * Generates cryptographic secrets and writes .env from .env.example.
 * Safe to re-run — skips if .env already exists.
 *
 * Usage: pnpm setup
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { server as opaqueServer, ready } from "@serenity-kit/opaque";
import { generateVAPIDKeys } from "web-push";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, ".env");
const EXAMPLE_PATH = resolve(ROOT, ".env.example");

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function main(): Promise<void> {
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
  const cronSecret = randomBase64(32);
  const bbsIssuerSecret = randomHex(32);
  const pairwiseSecret = randomHex(32);
  const dedupHmacSecret = randomHex(32);
  const humanityHmacSecret = randomHex(32);
  const claimSigningSecret = randomHex(32);
  const ciphertextHmacSecret = randomHex(32);
  const keyEncryptionKey = randomHex(32);

  console.log("  BETTER_AUTH_SECRET       done");
  console.log("  INTERNAL_SERVICE_TOKEN   done");
  console.log("  CRON_SECRET              done");
  console.log("  BBS_ISSUER_SECRET        done");
  console.log("  DEDUP_HMAC_SECRET        done");
  console.log("  HUMANITY_HMAC_SECRET     done");
  console.log("  PAIRWISE_SECRET          done");
  console.log("  CLAIM_SIGNING_SECRET     done");
  console.log("  CIPHERTEXT_HMAC_SECRET   done");
  console.log("  KEY_ENCRYPTION_KEY       done");

  console.log("  OPAQUE_SERVER_SETUP      generating...");
  await ready;
  const serverSetup = opaqueServer.createSetup();
  const publicKey = opaqueServer.getPublicKey(serverSetup);
  console.log("  OPAQUE_SERVER_SETUP      done");
  console.log("  OPAQUE public key        done");

  console.log("  VAPID keys               generating...");
  const vapidKeys = generateVAPIDKeys();
  console.log("  VAPID keys               done\n");

  let template = readFileSync(EXAMPLE_PATH, "utf8");

  const replacements: Record<string, string> = {
    BETTER_AUTH_SECRET: betterAuthSecret,
    OPAQUE_SERVER_SETUP: serverSetup,
    NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY: publicKey,
    INTERNAL_SERVICE_TOKEN: internalServiceToken,
    CRON_SECRET: cronSecret,
    BBS_ISSUER_SECRET: bbsIssuerSecret,
    DEDUP_HMAC_SECRET: dedupHmacSecret,
    HUMANITY_HMAC_SECRET: humanityHmacSecret,
    PAIRWISE_SECRET: pairwiseSecret,
    CLAIM_SIGNING_SECRET: claimSigningSecret,
    CIPHERTEXT_HMAC_SECRET: ciphertextHmacSecret,
    KEY_ENCRYPTION_KEY: keyEncryptionKey,
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
    console.log("Database schema pushed.\n");
  } catch {
    console.warn(
      "Database push failed — you can run `pnpm db:push:dev` manually.\n"
    );
  }

  console.log("Setup complete! Run `pnpm dev` to start the dev server.");
}

main();
