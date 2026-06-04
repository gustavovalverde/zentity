import "server-only";
import { hkdfSync } from "node:crypto";
import { p256 } from "@noble/curves/p256";
import {
  type CryptoKey,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  SignJWT,
} from "jose";
import { env } from "@/lib/env";

/**
 * Server-side DPoP proof minting for the zpay BFF channel.
 *
 * Two key sources, picked at first call and cached for the process:
 *
 * - When `ZPAY_DPOP_KEY_SEED` is set (production), the keypair is
 *   derived deterministically from the secret via HKDF-SHA-256, so
 *   every BFF replica and every cold-start lands on the same JWK
 *   thumbprint. That keeps the `(jkt, idempotency_key)` composite
 *   stable across restarts and across Vercel serverless invocations.
 * - When the seed is unset (dev), the keypair is generated ephemerally
 *   and a console warning explains that the JKT will drift across
 *   process restarts.
 *
 * This is not the same keypair as the Zentity-bound DPoP keys in
 * `poh-client.ts`. Those are issued and stored by the Zentity OAuth
 * stack and are scoped to that authentication channel; this helper is
 * scoped to the zpay payment channel.
 */

interface DpopKeyMaterial {
  jkt: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

const HKDF_INFO = "zpay/v1/dpop";
const HKDF_SALT = "zpay-dpop-key-v1";
const SCALAR_BYTES = 32;
const BASE64URL_PLUS = /\+/g;
const BASE64URL_SLASH = /\//g;
const BASE64URL_PAD = /=+$/;

let keyMaterialPromise: Promise<DpopKeyMaterial> | null = null;

function getDpopKeyMaterial(): Promise<DpopKeyMaterial> {
  if (!keyMaterialPromise) {
    keyMaterialPromise = env.ZPAY_DPOP_KEY_SEED
      ? deriveKeyMaterialFromSeed(env.ZPAY_DPOP_KEY_SEED)
      : generateEphemeralKeyMaterial();
  }
  return keyMaterialPromise;
}

async function deriveKeyMaterialFromSeed(
  seed: string
): Promise<DpopKeyMaterial> {
  const seedBytes = new TextEncoder().encode(seed);
  // HKDF-SHA-256 with a public salt and a fixed info string. The salt
  // is a constant rather than a random value because the goal is
  // determinism across processes that all hold the same seed; using a
  // random salt would defeat that.
  const stretched = hkdfSync(
    "sha256",
    seedBytes,
    new TextEncoder().encode(HKDF_SALT),
    HKDF_INFO,
    SCALAR_BYTES
  );
  // Reduce the 32 stretched bytes modulo the P-256 group order so the
  // resulting scalar is a valid private key. `@noble/curves/p256`
  // exposes the field, the order, and the scalar-to-public-key path,
  // so we do not vendor any of the constant-time arithmetic ourselves.
  const scalar = scalarModOrder(Buffer.from(stretched));
  const privateScalar = bigintToBytes(scalar, SCALAR_BYTES);
  const publicPoint = p256.Point.fromPrivateKey(privateScalar);
  const { x, y } = publicPoint.toAffine();
  const xBytes = bigintToBytes(x, SCALAR_BYTES);
  const yBytes = bigintToBytes(y, SCALAR_BYTES);

  const xB64 = bytesToBase64Url(xBytes);
  const yB64 = bytesToBase64Url(yBytes);
  const privateJwk: JWK = {
    kty: "EC",
    crv: "P-256",
    d: bytesToBase64Url(privateScalar),
    x: xB64,
    y: yB64,
  };
  const publicJwk: JWK = {
    kty: "EC",
    crv: "P-256",
    x: xB64,
    y: yB64,
  };
  const privateKey = (await importJWK(privateJwk, "ES256")) as CryptoKey;
  const jkt = await calculateJwkThumbprint(publicJwk, "sha256");
  return { jkt, privateKey, publicJwk };
}

async function generateEphemeralKeyMaterial(): Promise<DpopKeyMaterial> {
  console.warn(
    "[zpay-dpop] ZPAY_DPOP_KEY_SEED unset; JKT is volatile across BFF restarts. Set the env var to a stable secret in production."
  );
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const jkt = await calculateJwkThumbprint(publicJwk, "sha256");
  return { jkt, privateKey, publicJwk };
}

function scalarModOrder(bytes: Buffer): bigint {
  const order = p256.CURVE.n;
  const scalar = BigInt(`0x${bytes.toString("hex")}`);
  const reduced = scalar % order;
  // P-256 keys must be in [1, n-1]; if HKDF returns the zero scalar
  // (probability ~2^-256), shift by 1 so the call never panics on an
  // adversarially-chosen seed. Same guard `@noble/curves` applies
  // internally to its `randomPrivateKey` path.
  return reduced === 0n ? 1n : reduced;
}

function bigintToBytes(value: bigint, length: number): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, "0");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(BASE64URL_PLUS, "-")
    .replace(BASE64URL_SLASH, "_")
    .replace(BASE64URL_PAD, "");
}

export interface SignDpopProofInput {
  iat?: number;
  jti: string;
  method: string;
  url: string;
}

export interface SignedDpopProof {
  jkt: string;
  proofJwt: string;
}

/**
 * Mint a one-shot DPoP proof JWT for the given (method, url, jti).
 *
 * The `htm` claim is taken verbatim from `method`; canonicalise it to
 * upper case at the call site (RFC 9449 requires byte-exact match).
 * `htu` should be the canonical upstream URL (scheme + host + path)
 * because the verifier compares against a URL canonicalized by the
 * url crate (default-ports stripped, dot-segments resolved).
 *
 * `iat` defaults to the current wall-clock second. Override only when
 * generating fixtures for the +/- 60 second tolerance.
 */
export async function signDpopProof(
  input: SignDpopProofInput
): Promise<SignedDpopProof> {
  const { jkt, privateKey, publicJwk } = await getDpopKeyMaterial();
  const iat = input.iat ?? Math.floor(Date.now() / 1000);
  const proofJwt = await new SignJWT({
    htm: input.method,
    htu: input.url,
    jti: input.jti,
    iat,
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: publicJwk,
    })
    .sign(privateKey);
  return { proofJwt, jkt };
}

/**
 * Return the BFF process's JWK thumbprint. Useful for logging and for
 * assembling deterministic idempotency keys without minting a proof.
 */
export async function getDpopJkt(): Promise<string> {
  return (await getDpopKeyMaterial()).jkt;
}

/**
 * Test seam: discard the cached key material so the next call to
 * `getDpopKeyMaterial` re-derives. Only used by unit tests that mutate
 * the env between assertions.
 */
export function __resetDpopKeyMaterialForTests(): void {
  keyMaterialPromise = null;
}
