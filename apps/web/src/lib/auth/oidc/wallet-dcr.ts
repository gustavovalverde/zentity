/**
 * OIDC4VCI Wallet Client Registration
 *
 * Ensures the default wallet client exists in the database for OIDC4VCI
 * pre-authorized code flow. This client is used by wallets (like Demo Wallet)
 * to exchange pre-authorized codes for access tokens.
 *
 * The wallet client is a "public" OAuth client (no client_secret required)
 * since mobile/browser wallets cannot securely store secrets. Its subject type
 * is public too: the OIDC4VCI plugin reads the user id from the access
 * token's `sub`, so only a public-subject client receives credentials.
 */
import "server-only";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

const DEFAULT_WALLET_CLIENT_ID = "zentity-wallet";

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
      applicationType: "native",
      tokenEndpointAuthMethod: "none",
      disabled: false,
      skipConsent: true, // Wallet flow doesn't need consent page
      scopes: JSON.stringify(WALLET_CLIENT_SCOPES),
      grantTypes: JSON.stringify(WALLET_CLIENT_GRANT_TYPES),
      redirectUris: JSON.stringify([]),
      createdAt: new Date(),
    })
    .run();

  return DEFAULT_WALLET_CLIENT_ID;
}

const PAIRWISE_WALLET_REFUSAL =
  "credentials are issued only to wallet clients with public subjects, and this client is pairwise";

async function isPairwiseClient(clientId: unknown): Promise<boolean> {
  if (typeof clientId !== "string" || !clientId) {
    return false;
  }
  const client = await db
    .select({ subjectType: oauthClients.subjectType })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
  return client?.subjectType === "pairwise";
}

/**
 * The OIDC4VCI plugin looks the user up by the access token's `sub`, which is
 * pairwise for a pairwise client and so names no user. These two checks
 * refuse such a wallet with a clear error, at the offer and at the credential
 * endpoints, until the plugin resolves the user itself (U25 in
 * docs/adr/platform/0002-better-auth-patches.md).
 */
export async function authorizeWalletCredentialOffer(input: {
  clientId: string;
  session: { user: { id: string } };
  userId: string;
}): Promise<boolean> {
  if (await isPairwiseClient(input.clientId)) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_client",
      error_description: PAIRWISE_WALLET_REFUSAL,
    });
  }
  return input.userId === input.session.user.id;
}

export async function refusePairwiseCredentialToken(input: {
  tokenPayload: Record<string, unknown>;
}): Promise<void> {
  const { azp, client_id: clientId } = input.tokenPayload;
  if (await isPairwiseClient(azp ?? clientId)) {
    throw new APIError(
      "BAD_REQUEST",
      {
        error: "credential_request_denied",
        error_description: PAIRWISE_WALLET_REFUSAL,
      },
      { "Cache-Control": "no-store" }
    );
  }
}
