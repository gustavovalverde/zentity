const SYNTHETIC_EMAIL_DOMAINS = ["anon.zentity.app", "wallet.zentity.app"];

export function isSyntheticEmail(email: string): boolean {
  const domain = email.split("@")[1];
  return domain !== undefined && SYNTHETIC_EMAIL_DOMAINS.includes(domain);
}
