import "server-only";

import type { JWKOptions, Jwk, JwtOptions } from "better-auth/plugins/jwt";
import type { JWK } from "jose";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { generateExportedKeyPair } from "better-auth/plugins/jwt";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { importJWK, SignJWT } from "jose";

import { env } from "@/env";
import { invalidateLocalKeySet } from "@/lib/auth/jwt";
import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/oauth-provider";

import { resolveSubForClientId } from "./pairwise";

// ---------------------------------------------------------------------------
// Envelope encryption for JWKS private keys at rest (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENVELOPE_VERSION = 1;
const ENVELOPE_ALG = "aes-256-gcm";
const ENVELOPE_IV_BYTES = 12;
const ENVELOPE_AUTH_TAG_BYTES = 16;

interface EncryptedEnvelope {
  ct: string;
  iv: string;
  v: number;
}

let cachedKek: Buffer | null = null;

function getKek(): Buffer {
  cachedKek ??= createHash("sha256").update(env.KEY_ENCRYPTION_KEY).digest();
  return cachedKek;
}

export function encryptPrivateKey(plaintext: string): string {
  const kek = getKek();
  const iv = randomBytes(ENVELOPE_IV_BYTES);
  const cipher = createCipheriv(ENVELOPE_ALG, kek, iv, {
    authTagLength: ENVELOPE_AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    ct: Buffer.concat([encrypted, authTag]).toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptPrivateKey(stored: string): string {
  if (!isEncryptedEnvelope(stored)) {
    throw new Error("JWKS private key is not encrypted");
  }

  const kek = getKek();
  const envelope = JSON.parse(stored) as EncryptedEnvelope;
  const iv = Buffer.from(envelope.iv, "base64");
  const combined = Buffer.from(envelope.ct, "base64");

  const authTag = combined.subarray(combined.length - ENVELOPE_AUTH_TAG_BYTES);
  const ciphertext = combined.subarray(
    0,
    combined.length - ENVELOPE_AUTH_TAG_BYTES
  );

  const decipher = createDecipheriv(ENVELOPE_ALG, kek, iv, {
    authTagLength: ENVELOPE_AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith('{"v":');
}

// ---------------------------------------------------------------------------
// Signing keys (RS256 / EdDSA) on the Better Auth JWT plugin's key store
// ---------------------------------------------------------------------------

type SigningAlg = "RS256" | "EdDSA";

const SIGNING_KEY_CONFIGS = {
  RS256: { alg: "RS256", modulusLength: 2048 },
  EdDSA: { alg: "EdDSA", crv: "Ed25519" },
} as const satisfies Record<SigningAlg, JWKOptions>;

const SIGNING_ALGS = Object.keys(SIGNING_KEY_CONFIGS) as SigningAlg[];

const DAY_SECONDS = 86_400;
const KEY_ROTATION_INTERVAL_SECONDS = 90 * DAY_SECONDS;
// A retired key stays published for as long as the longest-lived token it
// signed: SD-JWT VCs, which the oidc4vci plugin issues for one year.
const KEY_GRACE_PERIOD_SECONDS = 365 * DAY_SECONDS;

/**
 * The JWT plugin's key policy, which Zentity's signer applies as well. RS256
 * is the primary key because the OAuth provider computes `at_hash` for
 * `keyPairConfig.alg`. The EdDSA access-token key stays out of
 * `keyPairConfigs`, which the provider advertises as ID token algorithms.
 * Rows carry the `KEY_ENCRYPTION_KEY` envelope, so the adapter decrypts them
 * and the plugin must not decrypt again.
 */
export const signingKeyOptions = {
  jwks: {
    keyPairConfig: SIGNING_KEY_CONFIGS.RS256,
    disablePrivateKeyEncryption: true,
    rotationInterval: KEY_ROTATION_INTERVAL_SECONDS,
    gracePeriod: KEY_GRACE_PERIOD_SECONDS,
  },
  adapter: {
    getJwks: getJwtSigningKeys,
    createJwk: createJwtSigningKey,
  },
} satisfies JwtOptions;

function isSigningAlg(alg: string | null | undefined): alg is SigningAlg {
  return alg === "RS256" || alg === "EdDSA";
}

/**
 * The plugin adapter's view of the key table: signing keys only (the JARM
 * encryption key shares the table), with private keys decrypted.
 */
export async function getJwtSigningKeys(): Promise<Jwk[]> {
  const rows = await db
    .select()
    .from(jwks)
    .where(inArray(jwks.alg, SIGNING_ALGS));

  return rows.flatMap((row) => {
    if (!isSigningAlg(row.alg)) {
      return [];
    }
    return [
      {
        id: row.id,
        publicKey: row.publicKey,
        privateKey: decryptPrivateKey(row.privateKey),
        createdAt: row.createdAt,
        alg: row.alg,
        ...(row.crv === "Ed25519" ? { crv: row.crv } : {}),
        ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
      },
    ];
  });
}

/** The plugin adapter's key creation path; the row is stored encrypted. */
export async function createJwtSigningKey(key: Omit<Jwk, "id">): Promise<Jwk> {
  const id = crypto.randomUUID();
  await db
    .insert(jwks)
    .values({
      id,
      publicKey: key.publicKey,
      privateKey: encryptPrivateKey(key.privateKey),
      alg: key.alg ?? null,
      crv: key.crv ?? null,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt ?? null,
    })
    .run();
  invalidateLocalKeySet();
  return { ...key, id };
}

/**
 * Mints a key the way the plugin's `createJwk` does: generated from the
 * algorithm's key pair config, stored through the adapter, and expiring after
 * the rotation interval.
 */
async function mintSigningKey(alg: SigningAlg): Promise<Jwk> {
  const { publicWebKey, privateWebKey } = await generateExportedKeyPair({
    jwks: { keyPairConfig: SIGNING_KEY_CONFIGS[alg] },
  });
  const createdAt = new Date();
  return await createJwtSigningKey({
    alg,
    ...(alg === "EdDSA" ? { crv: "Ed25519" } : {}),
    publicKey: JSON.stringify(publicWebKey),
    privateKey: JSON.stringify(privateWebKey),
    createdAt,
    expiresAt: new Date(
      createdAt.getTime() + signingKeyOptions.jwks.rotationInterval * 1000
    ),
  });
}

/**
 * Selects the key the plugin's `resolveSigningKey` would: the newest
 * unexpired key for the algorithm, minted on first use and again once it
 * expires. That function needs a Better Auth endpoint context, and Zentity
 * also signs from cron deliveries that run outside any request.
 */
async function getSigningKey(
  alg: SigningAlg
): Promise<{ kid: string; privateKey: CryptoKey | Uint8Array }> {
  const row = await db
    .select({ id: jwks.id, privateKey: jwks.privateKey })
    .from(jwks)
    .where(
      and(
        eq(jwks.alg, alg),
        or(isNull(jwks.expiresAt), gt(jwks.expiresAt, new Date()))
      )
    )
    .orderBy(desc(jwks.createdAt))
    .limit(1)
    .get();

  const key = row
    ? { id: row.id, privateKey: decryptPrivateKey(row.privateKey) }
    : await mintSigningKey(alg);
  return {
    kid: key.id,
    privateKey: await importJWK(JSON.parse(key.privateKey), alg),
  };
}

/**
 * Rotate a signing key now instead of waiting for `rotationInterval`: mint a
 * fresh key, then retire every other live key for the algorithm. Retired keys
 * stay published for the grace period.
 */
export async function rotateSigningKey(
  alg: SigningAlg
): Promise<{ newKid: string; retiredKids: string[] }> {
  const newKey = await mintSigningKey(alg);

  const now = new Date();
  const retired = await db
    .update(jwks)
    .set({ expiresAt: now })
    .where(
      and(
        eq(jwks.alg, alg),
        ne(jwks.id, newKey.id),
        or(isNull(jwks.expiresAt), gt(jwks.expiresAt, now))
      )
    )
    .returning({ id: jwks.id });

  invalidateLocalKeySet();
  return { newKid: newKey.id, retiredKids: retired.map((row) => row.id) };
}

function publicationCutoff(): Date {
  return new Date(Date.now() - signingKeyOptions.jwks.gracePeriod * 1000);
}

/** Deletes keys that expired longer ago than the grace period. */
export async function cleanupExpiredKeys(): Promise<number> {
  const result = await db
    .delete(jwks)
    .where(lt(jwks.expiresAt, publicationCutoff()))
    .run();
  invalidateLocalKeySet();
  return result.rowsAffected;
}

/**
 * The public JWKS: live signing keys plus retired ones still inside the grace
 * period, matching what the JWT plugin's own JWKS endpoint would publish.
 */
export async function getPublishedJwks(): Promise<{ keys: JWK[] }> {
  const rows = await db
    .select({
      alg: jwks.alg,
      crv: jwks.crv,
      id: jwks.id,
      publicKey: jwks.publicKey,
    })
    .from(jwks)
    .where(
      and(
        inArray(jwks.alg, SIGNING_ALGS),
        or(isNull(jwks.expiresAt), gt(jwks.expiresAt, publicationCutoff()))
      )
    );

  return {
    keys: rows.map((row) => ({
      ...(JSON.parse(row.publicKey) as JWK),
      kid: row.id,
      ...(row.alg ? { alg: row.alg } : {}),
      ...(row.crv ? { crv: row.crv } : {}),
    })),
  };
}

async function signWithAlg(
  payload: Record<string, unknown>,
  alg: SigningAlg,
  typ = "JWT"
): Promise<string> {
  const { kid, privateKey } = await getSigningKey(alg);

  return new SignJWT(payload)
    .setProtectedHeader({ alg, typ, kid })
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// JWT dispatcher
// ---------------------------------------------------------------------------

/**
 * A client-issued access token carries the subject identifier that client
 * receives everywhere else (pairwise for pairwise clients), never the raw user
 * id (ADR privacy/0015). Client-credentials tokens name the client itself.
 */
async function projectAccessTokenSubject(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const clientId = payload.azp ?? payload.client_id;
  if (
    typeof payload.sub !== "string" ||
    typeof clientId !== "string" ||
    payload.sub === clientId
  ) {
    return payload;
  }
  const sub = await resolveSubForClientId(payload.sub, clientId);
  if (!sub) {
    throw new Error(`Unknown client ${clientId} for access token subject`);
  }
  return { ...payload, sub };
}

/**
 * Access tokens (payload has `scope`) are EdDSA for compact size. Every other
 * JWT, including ID tokens, is RS256: the OAuth provider computes `at_hash`
 * for the JWT plugin's configured algorithm and rejects a mismatched signer.
 */
export async function signJwt(
  payload: Record<string, unknown>,
  header?: { typ?: string }
): Promise<string> {
  if (typeof payload.scope === "string") {
    return signWithAlg(
      await projectAccessTokenSubject(payload),
      "EdDSA",
      header?.typ
    );
  }
  return signWithAlg(payload, "RS256", header?.typ);
}
