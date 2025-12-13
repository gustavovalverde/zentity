/**
 * Client helper for checking whether a password appears in known breaches.
 *
 * Important:
 * - This is *UX-only* (pre-submit feedback). Better Auth still enforces the real
 *   server-side block via the `haveIBeenPwned()` plugin at sign-up/reset/change.
 * - The endpoint uses HIBP k-anonymity (range API) server-side. The client
 *   sends a SHA-1 hash (not the raw password) to our endpoint; the raw password
 *   is never sent to HIBP and does not appear in the `/api/password/pwned`
 *   network payload.
 */
export type PasswordPwnedResult = {
  compromised: boolean;
  skipped: boolean;
};

async function sha1HexUpper(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Calls `/api/password/pwned` and returns a normalized result.
 *
 * `skipped: true` means we intentionally did not check (too short/long) or the
 * check could not be completed (e.g., upstream unavailable).
 */
export async function checkPasswordPwned(
  password: string,
  opts?: { signal?: AbortSignal },
): Promise<PasswordPwnedResult> {
  const sha1 = await sha1HexUpper(password);
  const res = await fetch("/api/password/pwned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: opts?.signal,
    body: JSON.stringify({ sha1 }),
  });

  const data = (await res
    .json()
    .catch(() => null)) as PasswordPwnedResult | null;
  if (!res.ok || !data) return { compromised: false, skipped: true };
  return data;
}
