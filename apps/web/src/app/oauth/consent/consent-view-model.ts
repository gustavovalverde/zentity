const IPV6_LOOPBACK = /^\[(::1)\]$/;

export function extractMetadataHostname(
  metadataUrl: string | null | undefined
): string | null {
  if (!metadataUrl) {
    return null;
  }

  try {
    return new URL(metadataUrl).hostname;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  const ipv6Match = hostname.match(IPV6_LOOPBACK);
  return ipv6Match?.[1] ?? hostname;
}

function isLocalRedirectUri(uri: string): boolean {
  try {
    const host = normalizeHostname(new URL(uri).hostname);
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function areAllRedirectUrisLocal(
  redirectUris: string[] | null | undefined
): boolean {
  if (!redirectUris || redirectUris.length === 0) {
    return false;
  }

  return redirectUris.every(isLocalRedirectUri);
}
