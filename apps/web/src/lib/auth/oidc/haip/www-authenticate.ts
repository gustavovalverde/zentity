import { env } from "@/env";

const TRAILING_SLASH = /\/+$/;

export function getProtectedResourceMetadataUrl(): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASH, "");
  return `${base}/.well-known/oauth-protected-resource`;
}
