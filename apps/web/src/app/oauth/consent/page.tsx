import { eq } from "drizzle-orm";

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

    const meta = row?.metadata as
      | { optionalScopes?: string[] }
      | null
      | undefined;
    if (Array.isArray(meta?.optionalScopes)) {
      optionalScopes = meta.optionalScopes;
    }
  }

  return (
    <OAuthConsentClient
      clientId={clientId}
      clientMeta={clientMeta}
      optionalScopes={optionalScopes}
      scopeParam={params.scope ?? ""}
    />
  );
}
