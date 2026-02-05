import "server-only";

const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_SLASHES_REGEX = /^\/+/;

export const getAuthIssuer = (): string => {
  const base =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/api/auth";
    }
    url.pathname = url.pathname.replace(TRAILING_SLASHES_REGEX, "");
    return url.toString();
  } catch {
    return "http://localhost:3000/api/auth";
  }
};

export const joinAuthIssuerPath = (issuer: string, path: string): string => {
  const normalized = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return new URL(
    path.replace(LEADING_SLASHES_REGEX, ""),
    normalized
  ).toString();
};
