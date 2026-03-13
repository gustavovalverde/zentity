import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { getCachedSession } from "@/lib/auth/cached-session";
import { type AuthMode, detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { OAuthConsentClient } from "./consent-client";

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

    if (row?.metadata) {
      const meta = JSON.parse(row.metadata) as {
        optionalScopes?: string[];
      } | null;
      if (Array.isArray(meta?.optionalScopes)) {
        optionalScopes = meta.optionalScopes;
      }
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
