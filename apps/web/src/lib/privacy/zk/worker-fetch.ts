const CRS_HOST_PREFIXES = [
  "https://crs.aztec.network/",
  "https://crs.aztec-cdn.foundation/",
  "https://crs.aztec-labs.com/",
] as const;

function rewriteWorkerFetchUrl(url: string, origin: string): string {
  for (const prefix of CRS_HOST_PREFIXES) {
    if (url.startsWith(prefix)) {
      return `${origin}/api/bb-crs/${url.slice(prefix.length)}`;
    }
  }

  if (url.startsWith("/")) {
    return `${origin}${url}`;
  }

  return url;
}

export function rewriteWorkerFetchInput(
  input: RequestInfo | URL,
  origin: string
): RequestInfo | URL {
  if (typeof input === "string") {
    return rewriteWorkerFetchUrl(input, origin);
  }

  if (input instanceof URL) {
    const rewritten = rewriteWorkerFetchUrl(input.toString(), origin);
    return rewritten === input.toString() ? input : new URL(rewritten);
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    const rewritten = rewriteWorkerFetchUrl(input.url, origin);
    return rewritten === input.url ? input : new Request(rewritten, input);
  }

  return input;
}
