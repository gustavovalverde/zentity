/**
 * OIDC4VCI Wallet Client Registration
 *
 * Ensures the default wallet client exists in the database for OIDC4VCI
 * pre-authorized code flow. This client is used by wallets (like Demo Wallet)
 * to exchange pre-authorized codes for access tokens.
 *
 * The wallet client is a "public" OAuth client (no client_secret required)
 * since mobile/browser wallets cannot securely store secrets.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

const DEFAULT_WALLET_CLIENT_ID =
  process.env.OIDC4VCI_WALLET_CLIENT_ID || "zentity-wallet";

const WALLET_CLIENT_SCOPES = ["openid", "proof:identity"];
const WALLET_CLIENT_GRANT_TYPES = [
  "urn:ietf:params:oauth:grant-type:pre-authorized_code",
];

/**
 * Ensure the OIDC4VCI wallet client exists in the database.
 * Creates it if it doesn't exist. Safe to call multiple times.
 *
 * @returns The wallet client ID
 */
export async function ensureWalletClientExists(): Promise<string> {
  const existing = await db
    .select({ id: oauthClients.id })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, DEFAULT_WALLET_CLIENT_ID))
    .limit(1)
    .get();

  if (existing) {
    return DEFAULT_WALLET_CLIENT_ID;
  }

  await db
    .insert(oauthClients)
    .values({
      clientId: DEFAULT_WALLET_CLIENT_ID,
      name: "Zentity Wallet",
      public: true, // No client_secret required
      disabled: false,
      skipConsent: true, // Wallet flow doesn't need consent page
      scopes: WALLET_CLIENT_SCOPES,
      grantTypes: WALLET_CLIENT_GRANT_TYPES,
      redirectUris: [], // Not needed for pre-authorized code flow
      createdAt: new Date(),
    })
    .run();

  return DEFAULT_WALLET_CLIENT_ID;
}
