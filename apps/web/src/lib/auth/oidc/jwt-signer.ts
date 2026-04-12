import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

import { db } from "@/lib/db/connection";
import {
  type Jwk as JwkRow,
  jwks,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { mlDsaKeygen, mlDsaSign } from "@/lib/privacy/primitives/post-quantum";
import {
  bytesToBase64,
  bytesToBase64Url,
} from "@/lib/privacy/primitives/symmetric";

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

function deriveKek(raw: string): Buffer {
  return createHash("sha256").update(raw).digest();
}

let cachedKek: Buffer | null = null;

function getKek(): Buffer | null {
  if (cachedKek) {
    return cachedKek;
  }
  const raw = process.env.KEY_ENCRYPTION_KEY;
  if (!raw) {
    return null;
  }
  cachedKek = deriveKek(raw);
  return cachedKek;
}

export function encryptPrivateKey(plaintext: string): string {
  const kek = getKek();
  if (!kek) {
    return plaintext;
  }

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
  const kek = getKek();

  if (!isEncryptedEnvelope(stored)) {
    return stored;
  }

  if (!kek) {
    throw new Error(
      "KEY_ENCRYPTION_KEY is required to decrypt JWKS private keys"
    );
  }

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
// Standard signing key management (RS256 / ES256 / EdDSA)
// ---------------------------------------------------------------------------

type SigningAlg = "RS256" | "ES256" | "EdDSA" | "ML-DSA-65";
type StandardAlg = "RS256" | "ES256" | "EdDSA";

interface CachedSigningKey {
  kid: string;
  privateKey: CryptoKey;
}

const keyCache = new Map<StandardAlg, CachedSigningKey>();

// Expose cache for test-environment reset (Symbol avoids polluting the public API)
if (process.env.NODE_ENV === "test") {
  const sym = Symbol.for("zentity.jwt-signer-key-cache");
  (globalThis as Record<symbol, unknown>)[sym] = keyCache;
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

/**
 * Get the active signing key for an algorithm, or create one if none exists.
 *
 * Selection priority:
 * 1. Active key (expiresAt IS NULL) — the current signing key
 * 2. Overlap key (expiresAt > now()) — graceful mid-rotation fallback
 * 3. No key found — generate and persist a new one
 */
export async function getOrCreateSigningKey(
  alg: StandardAlg
): Promise<CachedSigningKey> {
  const cached = keyCache.get(alg);
  if (cached) {
    return cached;
  }

  const now = new Date();

  const row = await db
    .select()
    .from(jwks)
    .where(
      and(
        eq(jwks.alg, alg),
        or(isNull(jwks.expiresAt), gt(jwks.expiresAt, now))
      )
    )
    .orderBy(jwks.expiresAt, desc(jwks.createdAt))
    .limit(1)
    .get();

  if (!row) {
    return createSigningKey(alg);
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

async function createSigningKey(alg: StandardAlg): Promise<CachedSigningKey> {
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

const DEFAULT_OVERLAP_HOURS = 24;

/**
 * Rotate a signing key: mark the current active key with an expiry window
 * and generate a fresh key. During overlap, both keys appear in JWKS so
 * existing tokens remain verifiable.
 */
export async function rotateSigningKey(
  alg: StandardAlg,
  overlapHours = DEFAULT_OVERLAP_HOURS
): Promise<{ oldKid: string | null; newKid: string }> {
  await cleanupExpiredKeys();

  const activeKey = await db
    .select({ id: jwks.id })
    .from(jwks)
    .where(and(eq(jwks.alg, alg), isNull(jwks.expiresAt)))
    .limit(1)
    .get();

  let oldKid: string | null = null;

  if (activeKey) {
    const expiresAt = new Date(Date.now() + overlapHours * 3_600_000);
    await db
      .update(jwks)
      .set({ expiresAt })
      .where(eq(jwks.id, activeKey.id))
      .run();
    oldKid = activeKey.id;
  }

  keyCache.delete(alg);

  const newKey = await createSigningKey(alg);
  return { oldKid, newKid: newKey.kid };
}

export async function cleanupExpiredKeys(): Promise<number> {
  const now = new Date();
  const result = await db.delete(jwks).where(lt(jwks.expiresAt, now)).run();
  return result.rowsAffected;
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

// ---------------------------------------------------------------------------
// ML-DSA-65 signing (post-quantum)
// ---------------------------------------------------------------------------

const ML_DSA_ALG = "ML-DSA-65" as const;

interface MlDsaSigningKey {
  kid: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

let cachedMlDsaSigningKey: MlDsaSigningKey | null = null;

async function getOrCreateMlDsaSigningKey(): Promise<MlDsaSigningKey> {
  if (cachedMlDsaSigningKey) {
    return cachedMlDsaSigningKey;
  }

  const existing = await db
    .select()
    .from(jwks)
    .where(eq(jwks.alg, ML_DSA_ALG))
    .limit(1)
    .get();

  if (existing) {
    const privateKeyData = JSON.parse(
      decryptPrivateKey(existing.privateKey)
    ) as { raw: string };
    const publicKeyData = JSON.parse(existing.publicKey) as { pub: string };

    cachedMlDsaSigningKey = {
      kid: existing.id,
      secretKey: Buffer.from(privateKeyData.raw, "base64"),
      publicKey: Buffer.from(publicKeyData.pub, "base64"),
    };
    return cachedMlDsaSigningKey;
  }

  const { publicKey, secretKey } = mlDsaKeygen();
  const kid = crypto.randomUUID();

  const publicKeyJson = JSON.stringify({
    kty: "AKP",
    alg: ML_DSA_ALG,
    pub: bytesToBase64(publicKey),
  });
  const privateKeyJson = JSON.stringify({
    raw: bytesToBase64(secretKey),
  });

  await db
    .insert(jwks)
    .values({
      id: kid,
      publicKey: publicKeyJson,
      privateKey: encryptPrivateKey(privateKeyJson),
      alg: ML_DSA_ALG,
      crv: null,
    })
    .run();

  cachedMlDsaSigningKey = { kid, secretKey, publicKey };
  return cachedMlDsaSigningKey;
}

function encodeJwtPart(data: Record<string, unknown>): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(data)));
}

async function signJwtWithMlDsa(
  payload: Record<string, unknown>
): Promise<string> {
  const { kid, secretKey } = await getOrCreateMlDsaSigningKey();

  const header = { alg: ML_DSA_ALG, typ: "JWT", kid };
  const encodedHeader = encodeJwtPart(header);
  const encodedPayload = encodeJwtPart(payload);

  const signingInput = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`
  );
  const signature = mlDsaSign(signingInput, secretKey);

  return `${encodedHeader}.${encodedPayload}.${bytesToBase64Url(signature)}`;
}

// ---------------------------------------------------------------------------
// Multi-algorithm JWT dispatcher
// ---------------------------------------------------------------------------

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

export async function getClientSigningAlg(
  clientId: string
): Promise<SigningAlg> {
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

// ---------------------------------------------------------------------------
// Better-auth JWT adapter (JWKS view filtered to standard algs)
// ---------------------------------------------------------------------------

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
 * Better-auth's OIDC4VCI/JWT internals use this adapter to enumerate standard
 * signing keys. Filtered to exclude ML-DSA and encryption keys that `jose`
 * cannot import directly.
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
