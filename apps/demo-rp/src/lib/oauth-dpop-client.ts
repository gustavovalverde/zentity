import "server-only";

import { createDpopClientFromKeyPair, type DpopClient } from "@zentity/sdk/rp";
import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { oauthDpopKey } from "@/lib/db/schema";

// Zentity requires a server-issued nonce on every DPoP proof, and a client
// keeps the latest nonce it was sent. Reusing one client per bound access
// token keeps each request after the first to a single round trip.
const MAX_CACHED_CLIENTS = 500;
const clientsByAccessToken = new Map<string, DpopClient>();

export function rememberOAuthDpopClient(
  accessToken: string,
  client: DpopClient
): void {
  clientsByAccessToken.delete(accessToken);
  clientsByAccessToken.set(accessToken, client);
  if (clientsByAccessToken.size > MAX_CACHED_CLIENTS) {
    const oldest = clientsByAccessToken.keys().next().value;
    if (oldest !== undefined) {
      clientsByAccessToken.delete(oldest);
    }
  }
}

/**
 * Returns the DPoP client for the key a Zentity access token is bound to,
 * or null when no key was stored for the token.
 */
export async function getOAuthDpopClient(
  accessToken: string
): Promise<DpopClient | null> {
  const cached = clientsByAccessToken.get(accessToken);
  if (cached) {
    return cached;
  }

  const row = await getDb().query.oauthDpopKey.findFirst({
    where: eq(oauthDpopKey.accessToken, accessToken),
    columns: { privateJwk: true, publicJwk: true },
  });
  if (!row) {
    return null;
  }

  const client = await createDpopClientFromKeyPair({
    privateJwk: JSON.parse(row.privateJwk),
    publicJwk: JSON.parse(row.publicJwk),
  });
  rememberOAuthDpopClient(accessToken, client);
  return client;
}
