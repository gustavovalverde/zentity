import { env } from "@/env";

const FALLBACK_APP_ORIGIN = "http://localhost:3000";

export function getAppOrigin(): string {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL).origin;
  } catch {
    return FALLBACK_APP_ORIGIN;
  }
}

function getDevPort(): string {
  // PORT (Next.js standard) wins over NEXT_PUBLIC_APP_URL so `PORT=3006 pnpm dev`
  // works without editing .env. Production never reaches this branch.
  if (process.env.PORT) {
    return process.env.PORT;
  }
  try {
    const url = new URL(env.NEXT_PUBLIC_APP_URL);
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return "3000";
  }
}

export function getTrustedOrigins(): string[] {
  const origins = new Set<string>();
  origins.add(getAppOrigin());

  if (env.TRUSTED_ORIGINS) {
    for (const origin of env.TRUSTED_ORIGINS.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.add(trimmed);
      }
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const port = getDevPort();
    // Node 17+ may resolve "localhost" to IPv6 ([::1]); host.docker.internal
    // covers Docker network access. All variants must be enumerated.
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://[::1]:${port}`);
    origins.add(`http://host.docker.internal:${port}`);
  }

  return Array.from(origins);
}
