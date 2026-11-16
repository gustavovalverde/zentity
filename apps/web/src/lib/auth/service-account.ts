/**
 * Accounts Zentity's own tooling creates, such as the owner of the MCP HTTP
 * client, use addresses under this domain. RFC 6761 reserves `.invalid`, so
 * no mailbox can exist there, and sign-up refuses these addresses so no user
 * can hold one.
 */
const SERVICE_ACCOUNT_DOMAIN = "zentity.invalid";

export function serviceAccountEmail(localPart: string): string {
  return `${localPart}@${SERVICE_ACCOUNT_DOMAIN}`;
}

export function isServiceAccountEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${SERVICE_ACCOUNT_DOMAIN}`);
}
