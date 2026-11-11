import { p256 } from "@noble/curves/nist.js";
import {
  base64url,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  SignJWT,
} from "jose";
import { normalizeDpopHtu } from "./dpop-htu";

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

export interface DpopRequestInit extends RequestInit {
  /**
   * Access token to present. The proof binds it through `ath`, and the
   * request carries `Authorization: DPoP <accessToken>`.
   */
  accessToken?: string;
  /** Transport to send the request with. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

export interface DpopClient {
  keyPair: DpopKeyPair;
  /**
   * Sends `init` to `url` with a DPoP proof and handles server nonces
   * (RFC 9449 §8 and §9).
   *
   * The client remembers the latest `DPoP-Nonce` each origin returned, on
   * success or error, and puts it in the first proof. When the server
   * answers `use_dpop_nonce` (a 400 JSON error from an authorization server,
   * or a 401 `WWW-Authenticate` error from a resource server), the request
   * is retried once with the new nonce. Every other response, including
   * errors that carry a `DPoP-Nonce`, is returned as is. The retry resends
   * `init.body`, so pass a replayable body such as a string or
   * `URLSearchParams`, not a stream.
   */
  fetch(url: string | URL, init?: DpopRequestInit): Promise<Response>;
  /**
   * Signs one DPoP proof without sending a request. `htu` is the URL
   * without its query, and a URL with a fragment is rejected.
   */
  proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string>;
}

const DPOP_NONCE_HEADER = "DPoP-Nonce";
const USE_DPOP_NONCE = "use_dpop_nonce";
const WWW_AUTHENTICATE_USE_DPOP_NONCE_RE = /\berror\s*=\s*"?use_dpop_nonce"?/i;

function toUrlString(url: string | URL): string {
  return url instanceof URL ? url.toString() : url;
}

async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return base64url.encode(new Uint8Array(digest));
}

async function isNonceChallenge(response: Response): Promise<boolean> {
  if (response.status === 401) {
    const challenge = response.headers.get("WWW-Authenticate") ?? "";
    return WWW_AUTHENTICATE_USE_DPOP_NONCE_RE.test(challenge);
  }
  if (response.status !== 400) {
    return false;
  }
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return body?.error === USE_DPOP_NONCE;
  } catch {
    return false;
  }
}

async function createClient(keyPair: DpopKeyPair): Promise<DpopClient> {
  const privateKey = await importJWK(keyPair.privateJwk, "ES256");
  const noncesByOrigin = new Map<string, string>();

  async function proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string> {
    return new SignJWT({
      htm: method,
      htu: normalizeDpopHtu(url),
      jti: crypto.randomUUID(),
      ...(accessToken ? { ath: await hashAccessToken(accessToken) } : {}),
      ...(nonce ? { nonce } : {}),
    })
      .setIssuedAt()
      .setProtectedHeader({
        alg: "ES256",
        jwk: keyPair.publicJwk,
        typ: "dpop+jwt",
      })
      .sign(privateKey);
  }

  return {
    keyPair,
    proofFor,
    async fetch(url, init = {}) {
      const { accessToken, fetch: transport = globalThis.fetch, ...request } =
        init;
      const target = toUrlString(url);
      const origin = new URL(target).origin;
      const method = (request.method ?? "GET").toUpperCase();

      const send = async (nonce: string | undefined) => {
        const headers = new Headers(request.headers);
        headers.set("DPoP", await proofFor(method, target, accessToken, nonce));
        if (accessToken) {
          headers.set("Authorization", `DPoP ${accessToken}`);
        }
        const response = await transport(target, {
          ...request,
          method,
          headers,
        });
        const nextNonce = response.headers.get(DPOP_NONCE_HEADER);
        if (nextNonce) {
          noncesByOrigin.set(origin, nextNonce);
        }
        return { response, nextNonce };
      };

      const first = await send(noncesByOrigin.get(origin));
      if (first.nextNonce && (await isNonceChallenge(first.response))) {
        return (await send(first.nextNonce)).response;
      }
      return first.response;
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
  const reduced = bytesToBigInt(stretched) % p256.Point.Fn.ORDER;
  const scalar = reduced === 0n ? 1n : reduced;
  const privateScalar = bigIntToBytes(scalar, P256_SCALAR_BYTES);
  const { x, y } = p256.Point.BASE.multiply(scalar).toAffine();
  const xB64 = base64url.encode(bigIntToBytes(x, P256_SCALAR_BYTES));
  const yB64 = base64url.encode(bigIntToBytes(y, P256_SCALAR_BYTES));
  return {
    privateJwk: {
      crv: "P-256",
      d: base64url.encode(privateScalar),
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
