/**
 * RFC 9449 §4.2 `htu`: the target URI without query or fragment. A fragment is
 * never sent on the wire, so the client drops it instead of failing. The
 * result names the same origin and path as the request, so the proof cannot
 * apply to a different resource. A verifier must stay strict and reject a
 * proof whose `htu` carries a fragment, as Better Auth's `normalizeDpopHtu`
 * does.
 */
export function normalizeDpopHtu(url: string | URL): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}
