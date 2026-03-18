import "server-only";

import { hkdfSync } from "node:crypto";

import { env } from "@/env";

const cache = new Map<string, Buffer>();

function deriveKey(ikm: string, info: string, length: number): Buffer {
  const cached = cache.get(info);
  if (cached) {
    return cached;
  }

  const derived = Buffer.from(hkdfSync("sha256", ikm, "", info, length));
  cache.set(info, derived);
  return derived;
}

// ── Independent keys (own env vars, HKDF for defense-in-depth) ──

export function getClaimSigningKey(): Uint8Array {
  return deriveKey(env.CLAIM_SIGNING_SECRET, "zentity:claim-signing:v1", 32);
}

export function getCiphertextHmacKey(): Buffer {
  return deriveKey(
    env.CIPHERTEXT_HMAC_SECRET,
    "zentity:ciphertext-hmac:v1",
    32
  );
}

// ── HKDF-derived keys (from BETTER_AUTH_SECRET) ─────────────────

export function getOpaqueStateKey(): string {
  return deriveKey(
    env.BETTER_AUTH_SECRET,
    "zentity:opaque-state:v1",
    32
  ).toString("hex");
}

export function getConsentHmacKey(): string {
  return deriveKey(
    env.BETTER_AUTH_SECRET,
    "zentity:consent-hmac:v1",
    32
  ).toString("hex");
}

export function getIdentityIntentKey(): string {
  return deriveKey(
    env.BETTER_AUTH_SECRET,
    "zentity:identity-intent:v1",
    32
  ).toString("hex");
}
