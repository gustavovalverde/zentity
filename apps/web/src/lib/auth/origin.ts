import { env } from "@/env";

const FALLBACK_APP_ORIGIN = "http://localhost:3000";

export function getAppOrigin(): string {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL).origin;
  } catch {
    return FALLBACK_APP_ORIGIN;
  }
}

/**
 * Pin a request's origin to the canonical app origin before better-auth reads
 * `request.url`. A custom Next server reconstructs `request.url` from its bind
 * hostname (`0.0.0.0`, `[::]`) and a TLS-terminating proxy hides the public
 * scheme, so the URL the server sees never matches the origin clients derive
 * from discovery. DPoP binding (RFC 9449) compares the proof `htu` against that
 * URL at the token and introspection endpoints, so a non-canonical origin
 * rejects every otherwise-valid proof. Only the origin is rewritten; path,
 * query, method, headers, and body are preserved.
 */
export function canonicalizeRequestOrigin(request: Request): Request {
  const appOrigin = new URL(getAppOrigin());
  const url = new URL(request.url);
  if (url.protocol === appOrigin.protocol && url.host === appOrigin.host) {
    return request;
  }
  url.protocol = appOrigin.protocol;
  url.host = appOrigin.host;
  return new Request(url, request);
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
