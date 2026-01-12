import "server-only";

import { ready, server } from "@serenity-kit/opaque";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

const KNOWN_INSECURE_SECRETS = new Set([
  // `.env.example` placeholder
  "your-super-secret-key-change-in-production",
]);

export function getBetterAuthSecret(): string {
  const secret = getRequiredEnv("BETTER_AUTH_SECRET");

  // Keep this check simple and non-invasive (PoC hardening).
  if (process.env.NODE_ENV === "production") {
    if (secret.length < 32) {
      throw new Error(
        "BETTER_AUTH_SECRET must be at least 32 characters in production"
      );
    }
    if (KNOWN_INSECURE_SECRETS.has(secret)) {
      throw new Error(
        "BETTER_AUTH_SECRET is set to an insecure placeholder; generate a real secret (e.g., `openssl rand -base64 32`)"
      );
    }
  }

  return secret;
}

export function getOpaqueServerSetup(): string {
  return getRequiredEnv("OPAQUE_SERVER_SETUP");
}

// Cached server public key (derived from setup at runtime)
let cachedOpaquePublicKey: string | null = null;

/**
 * Derives the OPAQUE server public key from the server setup.
 * This is cached after the first call for performance.
 *
 * The public key is safe to expose to clients and is used for
 * server key pinning (MITM protection).
 */
export async function getOpaqueServerPublicKey(): Promise<string> {
  if (cachedOpaquePublicKey) {
    return cachedOpaquePublicKey;
  }

  await ready;
  const setup = getOpaqueServerSetup();
  cachedOpaquePublicKey = server.getPublicKey(setup);
  const pinned = process.env.NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY?.trim();
  if (pinned && pinned !== cachedOpaquePublicKey) {
    throw new Error(
      "NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY does not match OPAQUE_SERVER_SETUP"
    );
  }
  return cachedOpaquePublicKey;
}
