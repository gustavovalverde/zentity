import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { env } from "@/env";
import { getCachedSession } from "@/lib/auth/cached-session";
import { type AuthMode, detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import {
  deriveSecurityBadges,
  type SecurityBadge,
} from "./_components/client-security-badges";
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
  let securityBadges: SecurityBadge[] = [];

  if (clientId) {
    const row = await db
      .select({
        name: oauthClients.name,
        icon: oauthClients.icon,
        uri: oauthClients.uri,
        metadata: oauthClients.metadata,
        subjectType: oauthClients.subjectType,
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

    let signingAlg = "RS256";
    let requiresDpop = false;

    if (row?.metadata) {
      const meta = JSON.parse(row.metadata) as Record<string, unknown> | null;
      if (Array.isArray(meta?.optionalScopes)) {
        optionalScopes = meta.optionalScopes as string[];
      }
      if (typeof meta?.id_token_signed_response_alg === "string") {
        signingAlg = meta.id_token_signed_response_alg;
      }
      if (meta?.dpop_bound_access_tokens === true) {
        requiresDpop = true;
      }
    }

    const isPairwise = row?.subjectType === "pairwise" && !!env.PAIRWISE_SECRET;

    securityBadges = deriveSecurityBadges({
      signingAlg,
      isPairwise,
      requiresDpop,
    });
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
      securityBadges={securityBadges}
      wallet={wallet}
    />
  );
}
