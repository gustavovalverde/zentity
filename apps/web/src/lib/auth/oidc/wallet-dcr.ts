/**
 * OIDC4VCI Wallet Client Registration
 *
 * Ensures the built-in wallet client exists. Wallets without a registration
 * of their own redeem pre-authorized codes as this public client (no
 * client_secret), and the dashboard's credential offer targets it unless the
 * user names a registered wallet.
 *
 * Like every other client it is pairwise. It has no redirect URIs, so its
 * sector is the provider's `client/<client_id>` form. Every wallet app that
 * uses this client id shares one pairwise subject per user; the credential
 * endpoint resolves the user from the token's `ba_sub`, and credentials carry
 * no subject.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export const BUILT_IN_WALLET_CLIENT_ID = "zentity-wallet";

const PRE_AUTHORIZED_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code";
const WALLET_CLIENT_SECTOR = `client/${BUILT_IN_WALLET_CLIENT_ID}`;
const WALLET_CLIENT_SCOPES = ["openid", "proof:identity"];
const WALLET_CLIENT_GRANT_TYPES = [PRE_AUTHORIZED_CODE_GRANT_TYPE];

/**
 * Whether a registered client can redeem a credential offer made for it: it
 * exists, is enabled, and registered the pre-authorized code grant.
 */
export async function canRedeemCredentialOffers(
  clientId: string
): Promise<boolean> {
  const client = await db
    .select({
      disabled: oauthClients.disabled,
      grantTypes: oauthClients.grantTypes,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
  return (
    !!client &&
    !client.disabled &&
    parseStoredStringArray(client.grantTypes).includes(
      PRE_AUTHORIZED_CODE_GRANT_TYPE
    )
  );
}

/**
 * Ensure the OIDC4VCI wallet client exists and is pairwise. Creates it, or
 * upgrades a row an earlier release created with public subjects. Safe to
 * call multiple times.
 *
 * @returns The wallet client ID
 */
export async function ensureWalletClientExists(): Promise<string> {
  const existing = await db
    .select({
      sectorIdentifier: oauthClients.sectorIdentifier,
      subjectType: oauthClients.subjectType,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, BUILT_IN_WALLET_CLIENT_ID))
    .limit(1)
    .get();

  if (!existing) {
    await db
      .insert(oauthClients)
      .values({
        clientId: BUILT_IN_WALLET_CLIENT_ID,
        name: "Zentity Wallet",
        applicationType: "native",
        tokenEndpointAuthMethod: "none",
        disabled: false,
        skipConsent: true, // Wallet flow doesn't need consent page
        scopes: JSON.stringify(WALLET_CLIENT_SCOPES),
        grantTypes: JSON.stringify(WALLET_CLIENT_GRANT_TYPES),
        redirectUris: JSON.stringify([]),
        subjectType: "pairwise",
        sectorIdentifier: WALLET_CLIENT_SECTOR,
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: oauthClients.clientId })
      .run();
    return BUILT_IN_WALLET_CLIENT_ID;
  }

  if (
    existing.subjectType !== "pairwise" ||
    existing.sectorIdentifier !== WALLET_CLIENT_SECTOR
  ) {
    await db
      .update(oauthClients)
      .set({ subjectType: "pairwise", sectorIdentifier: WALLET_CLIENT_SECTOR })
      .where(eq(oauthClients.clientId, BUILT_IN_WALLET_CLIENT_ID))
      .run();
  }

  return BUILT_IN_WALLET_CLIENT_ID;
}
