/**
 * Placeholder addresses Zentity gives accounts that signed up without an
 * email: anonymous sign-ups and wallet sign-ups. No mailbox exists behind
 * them, so nothing is ever sent to one.
 */
export const ANONYMOUS_EMAIL_DOMAIN = "anon.zentity.app";
export const WALLET_EMAIL_DOMAIN = "wallet.zentity.app";

const SYNTHETIC_EMAIL_DOMAINS = new Set([
  ANONYMOUS_EMAIL_DOMAIN,
  WALLET_EMAIL_DOMAIN,
]);

export function isSyntheticEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return domain !== undefined && SYNTHETIC_EMAIL_DOMAINS.has(domain);
}
