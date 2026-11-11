/**
 * RFC 9449 §4.2 `htu`: the target URI without query or fragment. Matches
 * Better Auth's `normalizeDpopHtu`, which rejects a fragment instead of
 * stripping it.
 */
export function normalizeDpopHtu(url: string | URL): string {
  const parsed = new URL(url);
  if (parsed.hash) {
    throw new Error("DPoP proof htu must not contain a fragment");
  }
  return `${parsed.origin}${parsed.pathname}`;
}
