import "server-only";

import { db } from "@/lib/db/connection";
import { type Jwk as JwkRow, jwks } from "@/lib/db/schema/jwks";

const STANDARD_JWT_SIGNING_ALGS = new Set(["RS256", "ES256", "EdDSA"] as const);

type StandardJwtSigningAlg = "RS256" | "ES256" | "EdDSA";

interface JwtSigningKey {
  alg?: StandardJwtSigningAlg;
  createdAt: Date;
  crv?: string;
  expiresAt?: Date;
  id: string;
  privateKey: string;
  publicKey: string;
}

function isStandardJwtSigningAlg(
  alg: string | null | undefined
): alg is StandardJwtSigningAlg {
  return (
    typeof alg === "string" &&
    STANDARD_JWT_SIGNING_ALGS.has(alg as StandardJwtSigningAlg)
  );
}

/**
 * Better Auth's OIDC4VCI/JWT internals use the adapter JWK list to pick a
 * signing key and import it through `jose`. The shared `jwks` table also holds
 * encryption keys and our ML-DSA records, which `jose` cannot import yet.
 * Keep the adapter view restricted to the standard signing algorithms that
 * Better Auth can safely consume.
 */
export async function getJwtSigningKeys(): Promise<JwtSigningKey[]> {
  const rows = await db.select().from(jwks);
  const signingRows = rows.filter(
    (
      row
    ): row is JwkRow & {
      alg: StandardJwtSigningAlg;
      crv: string | null;
      expiresAt: Date | null;
    } => isStandardJwtSigningAlg(row.alg)
  );

  return signingRows.map((row) => ({
    id: row.id,
    publicKey: row.publicKey,
    privateKey: row.privateKey,
    createdAt: row.createdAt,
    alg: row.alg,
    ...(row.crv ? { crv: row.crv } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
  }));
}
