import "server-only";

import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { decryptPrivateKey, encryptPrivateKey } from "./key-vault";
import { signJwtWithMlDsa } from "./ml-dsa-signer";

type SigningAlg = "RS256" | "ES256" | "EdDSA" | "ML-DSA-65";

type StandardAlg = "RS256" | "ES256" | "EdDSA";

interface CachedSigningKey {
  kid: string;
  privateKey: CryptoKey;
}

const keyCache = new Map<StandardAlg, CachedSigningKey>();

/** Clear the module-level signing key cache (for test isolation). */
export function resetSigningKeyCache(): void {
  keyCache.clear();
}

const KEY_GEN_OPTIONS: Record<
  StandardAlg,
  { alg: string; opts: Record<string, unknown>; crv: string | null }
> = {
  RS256: {
    alg: "RS256",
    opts: { modulusLength: 2048, extractable: true },
    crv: null,
  },
  ES256: { alg: "ES256", opts: { extractable: true }, crv: "P-256" },
  EdDSA: {
    alg: "EdDSA",
    opts: { crv: "Ed25519", extractable: true },
    crv: "Ed25519",
  },
};

export async function getOrCreateSigningKey(
  alg: StandardAlg
): Promise<CachedSigningKey> {
  const cached = keyCache.get(alg);
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
    const config = KEY_GEN_OPTIONS[alg];
    const keyPair = await generateKeyPair(config.alg, config.opts);
    const publicJwk = await exportJWK(keyPair.publicKey);
    const privateJwk = await exportJWK(keyPair.privateKey);
    const kid = crypto.randomUUID();

    await db
      .insert(jwks)
      .values({
        id: kid,
        publicKey: JSON.stringify(publicJwk),
        privateKey: encryptPrivateKey(JSON.stringify(privateJwk)),
        alg,
        crv: config.crv,
      })
      .run();

    const result = { kid, privateKey: keyPair.privateKey };
    keyCache.set(alg, result);
    return result;
  }

  const privateJwk = JSON.parse(decryptPrivateKey(row.privateKey)) as Record<
    string,
    unknown
  >;
  const privateKey = await importJWK(privateJwk, alg);

  if (!(privateKey instanceof CryptoKey)) {
    throw new Error(`Failed to import ${alg} private key as CryptoKey`);
  }

  const result = { kid: row.id, privateKey };
  keyCache.set(alg, result);
  return result;
}

async function signWithAlg(
  payload: Record<string, unknown>,
  alg: StandardAlg
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
    const meta = JSON.parse(client.metadata) as Record<string, unknown>;
    const requested = meta.id_token_signed_response_alg;
    if (
      requested === "ES256" ||
      requested === "EdDSA" ||
      requested === "ML-DSA-65"
    ) {
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
  return signWithAlg(payload, alg as StandardAlg);
}
