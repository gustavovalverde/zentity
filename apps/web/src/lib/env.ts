import "server-only";

export function getRequiredEnv(name: string): string {
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
        "BETTER_AUTH_SECRET must be at least 32 characters in production",
      );
    }
    if (KNOWN_INSECURE_SECRETS.has(secret)) {
      throw new Error(
        "BETTER_AUTH_SECRET is set to an insecure placeholder; generate a real secret (e.g., `openssl rand -base64 32`)",
      );
    }
  }

  return secret;
}
