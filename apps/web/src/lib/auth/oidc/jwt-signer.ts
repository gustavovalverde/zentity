import "server-only";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { signJwtWithMlDsa } from "./ml-dsa-signer";

type SigningAlg = "RS256" | "EdDSA" | "ML-DSA-65";

interface CachedSigningKey {
  kid: string;
  privateKey: CryptoKey;
}

let cachedRsaKey: CachedSigningKey | null = null;
let cachedEdDsaKey: CachedSigningKey | null = null;

async function getOrCreateSigningKey(
  alg: "RS256" | "EdDSA"
): Promise<CachedSigningKey> {
  const cached = alg === "RS256" ? cachedRsaKey : cachedEdDsaKey;
  if (cached) {
    return cached;
  }

  const row = await db
    .select()
    .from(jwks)
    .where(eq(jwks.alg, alg))
    .limit(1)
    .get();

  if (!row) {
    const keyPair =
      alg === "RS256"
        ? await generateKeyPair("RS256", {
            modulusLength: 2048,
            extractable: true,
          })
        : await generateKeyPair("EdDSA", {
            crv: "Ed25519",
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
        alg,
        crv: alg === "EdDSA" ? "Ed25519" : null,
      })
      .run();

    const result = { kid, privateKey: keyPair.privateKey };
    if (alg === "RS256") {
      cachedRsaKey = result;
    } else {
      cachedEdDsaKey = result;
    }
    return result;
  }

  const privateJwk = JSON.parse(row.privateKey) as Record<string, unknown>;
  const privateKey = await importJWK(privateJwk, alg);

  if (!(privateKey instanceof CryptoKey)) {
    throw new Error(`Failed to import ${alg} private key as CryptoKey`);
  }

  const result = { kid: row.id, privateKey };
  if (alg === "RS256") {
    cachedRsaKey = result;
  } else {
    cachedEdDsaKey = result;
  }
  return result;
}

async function signWithAlg(
  payload: Record<string, unknown>,
  alg: "RS256" | "EdDSA"
): Promise<string> {
  const { kid, privateKey } = await getOrCreateSigningKey(alg);

  return new SignJWT(payload)
    .setProtectedHeader({ alg, typ: "JWT", kid })
    .sign(privateKey);
}

function resolveClientId(payload: Record<string, unknown>): string | null {
  const { aud } = payload;
  if (typeof aud === "string") {
    return aud;
  }
  if (Array.isArray(aud) && typeof aud[0] === "string") {
    return aud[0];
  }
  if (typeof payload.azp === "string") {
    return payload.azp;
  }
  return null;
}

const algCache = new Map<string, { alg: SigningAlg; expiresAt: number }>();
const ALG_CACHE_TTL_MS = 5 * 60 * 1000;

async function getClientSigningAlg(clientId: string): Promise<SigningAlg> {
  const cached = algCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.alg;
  }

  let alg: SigningAlg = "RS256";

  const client = await db
    .select({ metadata: oauthClients.metadata })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  if (client?.metadata) {
    const meta =
      typeof client.metadata === "string"
        ? (JSON.parse(client.metadata) as Record<string, unknown>)
        : (client.metadata as Record<string, unknown>);
    const requested = meta.id_token_signed_response_alg;
    if (requested === "EdDSA" || requested === "ML-DSA-65") {
      alg = requested;
    }
  }

  algCache.set(clientId, { alg, expiresAt: Date.now() + ALG_CACHE_TTL_MS });
  return alg;
}

/**
 * Multi-algorithm JWT dispatcher.
 *
 * - Access tokens (payload has `scope`) → always EdDSA for compact size
 * - ID tokens → RS256 by default (OIDC mandatory), EdDSA/ML-DSA-65 if client opts in
 */
export async function signJwt(
  payload: Record<string, unknown>
): Promise<string> {
  if (typeof payload.scope === "string") {
    return signWithAlg(payload, "EdDSA");
  }

  const clientId = resolveClientId(payload);
  const alg: SigningAlg = clientId
    ? await getClientSigningAlg(clientId)
    : "RS256";

  if (alg === "ML-DSA-65") {
    return signJwtWithMlDsa(payload);
  }
  return signWithAlg(payload, alg);
}
