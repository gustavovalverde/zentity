import type {
  EncryptionLevel,
  SecurityBadgeInput,
} from "./_components/security-badges";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { env } from "@/env";
import {
  type AuthMode,
  detectAuthMode,
  getCachedSession,
} from "@/lib/auth/session";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthClients, rpEncryptionKeys } from "@/lib/db/schema/oauth-provider";

import { OAuthConsentClient } from "./consent-client";
import {
  areAllRedirectUrisLocal,
  extractMetadataHostname,
} from "./consent-view-model";

const CONSENT_ERROR_MESSAGES: Record<string, string> = {
  consent_failed: "Unable to process consent request.",
};

export default async function OAuthConsentPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    client_id?: string;
    consent_error?: string;
    scope?: string;
  }>;
}>) {
  const params = await searchParams;
  const clientId = params.client_id ?? null;

  let clientMeta: {
    name: string;
    icon: string | null;
    uri: string | null;
    metadataUrl: string | null;
    redirectUris: string[] | null;
  } | null = null;
  let clientHostname: string | null = null;
  let isLocalApp = false;
  let optionalScopes: string[] = [];
  let securityBadgeInput: SecurityBadgeInput | null = null;

  if (clientId) {
    const row = await db
      .select({
        name: oauthClients.name,
        icon: oauthClients.icon,
        uri: oauthClients.uri,
        metadata: oauthClients.metadata,
        subjectType: oauthClients.subjectType,
        metadataUrl: oauthClients.metadataUrl,
        redirectUris: oauthClients.redirectUris,
      })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)
      .get();

    if (row?.name) {
      const redirectUris = parseStoredStringArray(row.redirectUris);
      clientMeta = {
        name: row.name,
        icon: row.icon,
        uri: row.uri,
        metadataUrl: row.metadataUrl,
        redirectUris,
      };
      clientHostname = extractMetadataHostname(row.metadataUrl);
      isLocalApp = areAllRedirectUrisLocal(redirectUris);
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

    // Query compliance encryption key for this client
    let encryptionLevel: EncryptionLevel = "none";
    const encKey = await db
      .select({ keyAlgorithm: rpEncryptionKeys.keyAlgorithm })
      .from(rpEncryptionKeys)
      .where(
        and(
          eq(rpEncryptionKeys.clientId, clientId),
          eq(rpEncryptionKeys.status, "active")
        )
      )
      .limit(1)
      .get();

    if (encKey?.keyAlgorithm === "ml-kem-768") {
      encryptionLevel = "post-quantum";
    } else if (encKey) {
      encryptionLevel = "standard";
    }

    securityBadgeInput = {
      signingAlg,
      isPairwise,
      requiresDpop,
      encryptionLevel,
    };
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
      clientHostname={clientHostname}
      clientId={clientId}
      clientMeta={clientMeta}
      initialErrorMessage={
        params.consent_error
          ? (CONSENT_ERROR_MESSAGES[params.consent_error] ??
            "Unable to process consent request.")
          : null
      }
      isLocalApp={isLocalApp}
      optionalScopes={optionalScopes}
      scopeParam={params.scope ?? ""}
      securityBadgeInput={securityBadgeInput}
      wallet={wallet}
    />
  );
}
