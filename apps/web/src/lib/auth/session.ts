import "server-only";

import type { headers } from "next/headers";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { getPrimaryWalletAddress } from "@/lib/db/queries/auth";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/privacy";

type HeadersObject = Awaited<ReturnType<typeof headers>>;

// Per-request session memoization via React.cache(). Prevents waterfall
// getSession() calls across layout/page/child within a single request.
// Safe for shared browsers: cache is per-request, discarded on completion.
export const getCachedSession = cache(async (headersObj: HeadersObject) => {
  return await auth.api.getSession({ headers: headersObj });
});

// Bypass the encrypted session_data cookie cache when a flow depends on
// fields written to the DB after session creation (e.g. authContextId on
// interactive approval pages).
export const getFreshSession = cache(async (headersObj: HeadersObject) => {
  return await auth.api.getSession({
    headers: headersObj,
    query: { disableCookieCache: true },
  });
});

export type AuthMode = "passkey" | "opaque" | "wallet" | null;

interface DetectedAuth {
  authMode: AuthMode;
  wallet: { address: string; chainId: number } | null;
}

const OPAQUE_CREDENTIAL_ID = "opaque";
const WALLET_CREDENTIAL_PREFIX = "wallet";

// Figures out which credential the user enrolled FHE keys under — passkey
// PRF, OPAQUE password, or wallet signature. Used by consent and CIBA
// approval pages to pick the vault-unlock UI. Priority: passkey > OPAQUE > wallet.
export async function detectAuthMode(userId: string): Promise<DetectedAuth> {
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
