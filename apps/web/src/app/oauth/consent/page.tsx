import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { getPrimaryWalletAddress } from "@/lib/db/queries/auth";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/crypto";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { OAuthConsentClient } from "./consent-client";

type AuthMode = "passkey" | "opaque" | "wallet" | null;

const OPAQUE_CREDENTIAL_ID = "opaque";
const WALLET_CREDENTIAL_PREFIX = "wallet";

async function detectAuthMode(userId: string): Promise<{
  authMode: AuthMode;
  wallet: { address: string; chainId: number } | null;
}> {
  // Find any FHE_KEYS secret for this user and check its wrappers
  const secret = await db
    .select({ id: encryptedSecrets.id })
    .from(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.userId, userId),
        eq(encryptedSecrets.secretType, "fhe_keys")
      )
    )
    .limit(1)
    .get();

  if (!secret) {
    return { authMode: null, wallet: null };
  }

  const wrappers = await db
    .select({
      credentialId: secretWrappers.credentialId,
      prfSalt: secretWrappers.prfSalt,
    })
    .from(secretWrappers)
    .where(eq(secretWrappers.secretId, secret.id))
    .all();

  if (wrappers.length === 0) {
    return { authMode: null, wallet: null };
  }

  // Priority: passkey > OPAQUE > wallet (matches client-side loadSecret order)
  if (wrappers.some((w) => w.prfSalt)) {
    return { authMode: "passkey", wallet: null };
  }

  if (wrappers.some((w) => w.credentialId === OPAQUE_CREDENTIAL_ID)) {
    return { authMode: "opaque", wallet: null };
  }

  if (
    wrappers.some((w) => w.credentialId.startsWith(WALLET_CREDENTIAL_PREFIX))
  ) {
    const wallet = await getPrimaryWalletAddress(userId);
    return { authMode: "wallet", wallet };
  }

  return { authMode: null, wallet: null };
}

export default async function OAuthConsentPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ client_id?: string; scope?: string }>;
}>) {
  const params = await searchParams;
  const clientId = params.client_id ?? null;

  let clientMeta: {
    name: string;
    icon: string | null;
    uri: string | null;
  } | null = null;
  let optionalScopes: string[] = [];

  if (clientId) {
    const row = await db
      .select({
        name: oauthClients.name,
        icon: oauthClients.icon,
        uri: oauthClients.uri,
        metadata: oauthClients.metadata,
      })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)
      .get();

    if (row?.name) {
      clientMeta = {
        name: row.name,
        icon: row.icon,
        uri: row.uri,
      };
    }

    const meta = row?.metadata as
      | { optionalScopes?: string[] }
      | null
      | undefined;
    if (Array.isArray(meta?.optionalScopes)) {
      optionalScopes = meta.optionalScopes;
    }
  }

  // Detect auth mode for vault unlock UI
  const session = await getCachedSession(await headers());
  let authMode: AuthMode = null;
  let wallet: { address: string; chainId: number } | null = null;

  if (session?.user?.id) {
    const detected = await detectAuthMode(session.user.id);
    authMode = detected.authMode;
    wallet = detected.wallet;
  }

  return (
    <OAuthConsentClient
      authMode={authMode}
      clientId={clientId}
      clientMeta={clientMeta}
      optionalScopes={optionalScopes}
      scopeParam={params.scope ?? ""}
      wallet={wallet}
    />
  );
}
