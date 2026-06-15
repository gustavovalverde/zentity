import { p256 } from "@noble/curves/p256";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

const BASE64URL_PLUS_RE = /\+/g;
const BASE64URL_SLASH_RE = /\//g;
const BASE64URL_PADDING_RE = /=+$/;

const P256_SCALAR_BYTES = 32;
// HKDF parameters for the zpay payment-channel DPoP key. They are wire
// constants, not identifiers: changing them rotates the derived `jkt`,
// which the (jkt, idempotency_key) composite and the wallet's cnf.jkt
// binding depend on. Keep them stable across repos and runtimes.
const DEFAULT_DPOP_SEED_SALT = "zpay-dpop-key-v1";
const DEFAULT_DPOP_SEED_INFO = "zpay/v1/dpop";

export interface DpopKeyPair {
  privateJwk: JWK;
  publicJwk: JWK;
}

export interface DpopClient {
  keyPair: DpopKeyPair;
  proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string>;
  withNonceRetry<T>(
    attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
  ): Promise<{ response: Response; result: T }>;
}

function toUrlString(url: string | URL): string {
  return url instanceof URL ? url.toString() : url;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa !== "function") {
    throw new Error("Base64url encoding is unavailable in this runtime");
  }

  return btoa(binary)
    .replace(BASE64URL_PLUS_RE, "-")
    .replace(BASE64URL_SLASH_RE, "_")
    .replace(BASE64URL_PADDING_RE, "");
}

export function encodeStringBase64Url(value: string): string {
  return encodeBase64Url(new TextEncoder().encode(value));
}

async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return encodeBase64Url(new Uint8Array(digest));
}

async function createClient(keyPair: DpopKeyPair): Promise<DpopClient> {
  const privateKey = await importJWK(keyPair.privateJwk, "ES256");

  return {
    keyPair,
    async proofFor(
      method: string,
      url: string | URL,
      accessToken?: string,
      nonce?: string
    ): Promise<string> {
      const builder = new SignJWT({
        htm: method,
        htu: toUrlString(url),
        jti: crypto.randomUUID(),
        ...(accessToken ? { ath: await hashAccessToken(accessToken) } : {}),
        ...(nonce ? { nonce } : {}),
      })
        .setIssuedAt()
        .setProtectedHeader({
          alg: "ES256",
          jwk: keyPair.publicJwk,
          typ: "dpop+jwt",
        });

      return builder.sign(privateKey);
    },
    async withNonceRetry<T>(
      attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
    ): Promise<{ response: Response; result: T }> {
      const initial = await attempt();
      if (
        initial.response.status !== 400 &&
        initial.response.status !== 401
      ) {
        return initial;
      }

      const nonce = initial.response.headers.get("DPoP-Nonce");
      if (!nonce) {
        return initial;
      }

      return attempt(nonce);
    },
  };
}

export async function generateDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });

  return {
    privateJwk: await exportJWK(privateKey),
    publicJwk: await exportJWK(publicKey),
  };
}

export async function createDpopClient(): Promise<DpopClient> {
  return createClient(await generateDpopKeyPair());
}

export async function createDpopClientFromKeyPair(
  keyPair: DpopKeyPair
): Promise<DpopClient> {
  return createClient(keyPair);
}

export interface DeriveDpopKeyPairOptions {
  /** HKDF salt. Defaults to the zpay payment channel; override only with a coordinated `jkt` rotation. */
  salt?: string;
  /** HKDF info string. Defaults to the zpay payment channel. */
  info?: string;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, "0");
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex.length > 0 ? BigInt(`0x${hex}`) : 0n;
}

/**
 * Derive a stable P-256 DPoP keypair from a secret seed: HKDF-SHA-256 to
 * a 32-byte scalar, reduced modulo the P-256 group order, then the public
 * point. Deterministic: the same seed always yields the same JWK
 * thumbprint, so every BFF replica and cold start lands on one `jkt`,
 * keeping the (jkt, idempotency_key) composite and the wallet's cnf.jkt
 * binding stable.
 *
 * Pure and runtime-agnostic: pass the seed in (no env, no node:crypto).
 * Separate channels by passing a different seed, never a parallel
 * implementation.
 */
export async function deriveDpopKeyPairFromSeed(
  seed: string,
  options: DeriveDpopKeyPairOptions = {}
): Promise<DpopKeyPair> {
  const ikm = new TextEncoder().encode(seed);
  const hkdfKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const stretched = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(options.salt ?? DEFAULT_DPOP_SEED_SALT),
        info: new TextEncoder().encode(options.info ?? DEFAULT_DPOP_SEED_INFO),
      },
      hkdfKey,
      P256_SCALAR_BYTES * 8
    )
  );
  // Reduce to a valid private scalar in [1, n-1]; guard the ~2^-256 zero case.
  const reduced = bytesToBigInt(stretched) % p256.CURVE.n;
  const scalar = reduced === 0n ? 1n : reduced;
  const privateScalar = bigIntToBytes(scalar, P256_SCALAR_BYTES);
  const { x, y } = p256.Point.fromPrivateKey(privateScalar).toAffine();
  const xB64 = encodeBase64Url(bigIntToBytes(x, P256_SCALAR_BYTES));
  const yB64 = encodeBase64Url(bigIntToBytes(y, P256_SCALAR_BYTES));
  return {
    privateJwk: {
      crv: "P-256",
      d: encodeBase64Url(privateScalar),
      kty: "EC",
      x: xB64,
      y: yB64,
    },
    publicJwk: { crv: "P-256", kty: "EC", x: xB64, y: yB64 },
  };
}

export async function createDpopClientFromSeed(
  seed: string,
  options?: DeriveDpopKeyPairOptions
): Promise<DpopClient> {
  return createClient(await deriveDpopKeyPairFromSeed(seed, options));
}
