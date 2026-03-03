import "server-only";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";

const JARM_ALG = "ECDH-ES";
let cachedJarmJwk: JsonWebKey | null = null;

/**
 * Lazily generates and persists an ECDH-ES P-256 key pair for JARM decryption.
 * The private JWK is returned for use with `createJarmHandler`.
 */
export async function getJarmDecryptionKey(): Promise<JsonWebKey> {
  if (cachedJarmJwk) {
    return cachedJarmJwk;
  }

  const row = await db
    .select()
    .from(jwks)
    .where(eq(jwks.alg, JARM_ALG))
    .limit(1)
    .get();

  if (row) {
    cachedJarmJwk = JSON.parse(row.privateKey) as JsonWebKey;
    return cachedJarmJwk;
  }

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
      privateKey: JSON.stringify(privateJwk),
      alg: JARM_ALG,
      crv: "P-256",
    })
    .run();

  cachedJarmJwk = privateJwk as JsonWebKey;
  return cachedJarmJwk;
}
