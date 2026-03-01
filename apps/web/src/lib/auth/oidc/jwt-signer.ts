import "server-only";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { signJwtWithMlDsa } from "./ml-dsa-signer";

type SigningAlg = "EdDSA" | "ML-DSA-65";

interface EdDsaSigningKey {
  kid: string;
  privateKey: CryptoKey;
}

let cachedEdDsaKey: EdDsaSigningKey | null = null;

async function getOrCreateEdDsaSigningKey(): Promise<EdDsaSigningKey> {
  if (cachedEdDsaKey) {
    return cachedEdDsaKey;
  }

  const row = await db
    .select()
    .from(jwks)
    .where(eq(jwks.alg, "EdDSA"))
    .limit(1)
    .get();

  if (!row) {
    const keyPair = await generateKeyPair("EdDSA", {
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
        alg: "EdDSA",
        crv: "Ed25519",
      })
      .run();

    cachedEdDsaKey = { kid, privateKey: keyPair.privateKey };
    return cachedEdDsaKey;
  }

  const privateJwk = JSON.parse(row.privateKey) as Record<string, unknown>;
  const privateKey = await importJWK(privateJwk, "EdDSA");

  if (!(privateKey instanceof CryptoKey)) {
    throw new Error("Failed to import EdDSA private key as CryptoKey");
  }

  cachedEdDsaKey = { kid: row.id, privateKey };
  return cachedEdDsaKey;
}

async function signWithEdDsa(
  payload: Record<string, unknown>
): Promise<string> {
  const { kid, privateKey } = await getOrCreateEdDsaSigningKey();

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid })
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

  let alg: SigningAlg = "EdDSA";

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
    if (meta.id_token_signed_response_alg === "ML-DSA-65") {
      alg = "ML-DSA-65";
    }
  }

  algCache.set(clientId, { alg, expiresAt: Date.now() + ALG_CACHE_TTL_MS });
  return alg;
}

/**
 * Dual-algorithm JWT dispatcher.
 *
 * - Access tokens (payload has `scope`) → always EdDSA for standard library compat
 * - ID tokens → EdDSA by default, ML-DSA-65 if client metadata opts in
 */
export async function signJwt(
  payload: Record<string, unknown>
): Promise<string> {
  if (typeof payload.scope === "string") {
    return signWithEdDsa(payload);
  }

  const clientId = resolveClientId(payload);
  if (clientId) {
    const alg = await getClientSigningAlg(clientId);
    if (alg === "ML-DSA-65") {
      return signJwtWithMlDsa(payload);
    }
  }

  return signWithEdDsa(payload);
}
