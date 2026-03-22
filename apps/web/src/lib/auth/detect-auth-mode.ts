import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { getPrimaryWalletAddress } from "@/lib/db/queries/auth";
import { encryptedSecrets, secretWrappers } from "@/lib/db/schema/crypto";

export type AuthMode = "passkey" | "opaque" | "wallet" | null;

interface DetectedAuth {
  authMode: AuthMode;
  wallet: { address: string; chainId: number } | null;
}

const OPAQUE_CREDENTIAL_ID = "opaque";
const WALLET_CREDENTIAL_PREFIX = "wallet";

/**
 * Detect how the user enrolled their FHE keys — passkey PRF, OPAQUE password,
 * or wallet signature. Priority: passkey > OPAQUE > wallet.
 *
 * Used by both the OAuth consent page and the CIBA approval page to determine
 * which vault unlock UI to render.
 */
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
