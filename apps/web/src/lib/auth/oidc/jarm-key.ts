import "server-only";

import { desc, eq } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";

import { decryptPrivateKey, encryptPrivateKey } from "./key-vault";

const JARM_ALG = "ECDH-ES";
const KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
let cachedJarmJwk: JsonWebKey | null = null;

async function createJarmKey(): Promise<JsonWebKey> {
  const keyPair = await generateKeyPair("ECDH-ES", {
    crv: "P-256",
    extractable: true,
  });
  const publicJwk = await exportJWK(keyPair.publicKey);
  const privateJwk = await exportJWK(keyPair.privateKey);
  const kid = crypto.randomUUID();

  await db
    .insert(jwks)
    .values({
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: encryptPrivateKey(JSON.stringify(privateJwk)),
      alg: JARM_ALG,
      crv: "P-256",
      expiresAt: new Date(Date.now() + KEY_LIFETIME_MS),
    })
    .run();

  cachedJarmJwk = privateJwk as JsonWebKey;
  return cachedJarmJwk;
}

/**
 * Returns the active ECDH-ES P-256 key for JARM decryption.
 * If the current key is expired, generates a new one (old keys remain
 * in the DB for a grace period so in-flight responses can still be
 * decrypted).
 */
export async function getJarmDecryptionKey(): Promise<JsonWebKey> {
  if (cachedJarmJwk) {
    return cachedJarmJwk;
  }

  const row = await db
    .select()
    .from(jwks)
    .where(eq(jwks.alg, JARM_ALG))
    .orderBy(desc(jwks.createdAt))
    .limit(1)
    .get();

  if (row) {
    const isExpired = row.expiresAt && new Date(row.expiresAt) <= new Date();
    if (isExpired) {
      cachedJarmJwk = null;
      return createJarmKey();
    }
    cachedJarmJwk = JSON.parse(decryptPrivateKey(row.privateKey)) as JsonWebKey;
    return cachedJarmJwk;
  }

  return createJarmKey();
}
