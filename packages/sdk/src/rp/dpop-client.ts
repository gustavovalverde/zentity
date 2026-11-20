import {
  createDpopNonceCache,
  createDpopProof,
  DPOP_NONCE_HEADER,
  isDpopNonceChallenge,
} from "@better-auth/core/oauth2/dpop-client";
import { p256 } from "@noble/curves/nist.js";
import { bytesToNumberBE, numberToBytesBE } from "@noble/curves/utils.js";
import { base64url, exportJWK, generateKeyPair, type JWK } from "jose";

const P256_SCALAR_BYTES = 32;
// HKDF parameters for the zpay payment-channel DPoP key. They are wire
// constants, not identifiers: changing them rotates the derived `jkt`,
// which the (jkt, idempotency_key) composite and the wallet's cnf.jkt
// binding depend on. Keep them stable across repos and runtimes.
const DEFAULT_DPOP_SEED_SALT = "zpay-dpop-key-v1";
const DEFAULT_DPOP_SEED_INFO = "zpay/v1/dpop";
const ES256_KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

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
  /**
   * Transport to send the request with, called as `(url, init)` with the
   * `DPoP` header set. Defaults to the global `fetch`.
   */
  fetch?: typeof globalThis.fetch;
  /** Refreshes request authentication after a DPoP nonce challenge. */
  onNonceRetry?: (() => Promise<void> | void) | undefined;
}

export interface DpopClient {
  /**
   * Sends `init` to `url` with a DPoP proof and handles server nonces
   * (RFC 9449 §8 and §9).
   *
   * The client remembers the latest `DPoP-Nonce` each origin returned, on
   * success or error, and puts it in the first proof. When the server
   * answers `use_dpop_nonce` with a nonce the proof did not already carry
   * (a 400 JSON error from an authorization server, or a 401
   * `WWW-Authenticate: DPoP` challenge from a resource server), the request
   * is retried once with the new nonce. Every other response, including
   * errors that carry a `DPoP-Nonce`, is returned as is. The retry resends
   * `init.body`, so pass a replayable body such as a string or
   * `URLSearchParams`, not a stream.
   */
  fetch(url: string | URL, init?: DpopRequestInit): Promise<Response>;
  keyPair: DpopKeyPair;
  /**
   * Signs one DPoP proof without sending a request. `htu` is the URL
   * without its query and fragment (RFC 9449 §4.2).
   */
  proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string>;
}

/**
 * RFC 9449 §4.2 `htu` has no fragment. A fragment never reaches the server,
 * so the client drops it rather than failing; Better Auth's proof signer
 * rejects one, as a verifier must.
 */
function withoutFragment(url: string | URL): string {
  const target = new URL(url);
  target.hash = "";
  return target.href;
}

async function createClient(keyPair: DpopKeyPair): Promise<DpopClient> {
  const signingKeyPair: CryptoKeyPair = {
    privateKey: await crypto.subtle.importKey(
      "jwk",
      keyPair.privateJwk,
      ES256_KEY_ALGORITHM,
      false,
      ["sign"]
    ),
    // Extractable because the proof header embeds the public JWK, which
    // Better Auth's proof signer exports from this key.
    publicKey: await crypto.subtle.importKey(
      "jwk",
      keyPair.publicJwk,
      ES256_KEY_ALGORITHM,
      true,
      ["verify"]
    ),
  };
  const nonceCache = createDpopNonceCache();

  async function proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string> {
    return createDpopProof({
      keyPair: signingKeyPair,
      method,
      url: withoutFragment(url),
      ...(accessToken ? { accessToken } : {}),
      ...(nonce ? { nonce } : {}),
    });
  }

  return {
    keyPair,
    proofFor,
    // Not Better Auth's createDpopFetch: before retrying it awaits
    // cancelling the challenge body, which never settles when the transport
    // kept an unread clone of the response.
    async fetch(url, init = {}) {
      const {
        accessToken,
        fetch: transport = globalThis.fetch,
        onNonceRetry,
        ...request
      } = init;
      const target = String(url);
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
        const nextNonce = response.headers.get(DPOP_NONCE_HEADER) ?? undefined;
        if (nextNonce) {
          await nonceCache.set(origin, nextNonce);
        }
        return { response, nextNonce };
      };

      const sentNonce = await nonceCache.get(origin);
      const first = await send(sentNonce);
      // The nonce the rejected proof already carried would fail again.
      if (
        first.nextNonce &&
        first.nextNonce !== sentNonce &&
        (await isDpopNonceChallenge(first.response))
      ) {
        await onNonceRetry?.();
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
  /** HKDF info string. Defaults to the zpay payment channel. */
  info?: string;
  /** HKDF salt. Defaults to the zpay payment channel; override only with a coordinated `jkt` rotation. */
  salt?: string;
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
  const reduced = bytesToNumberBE(stretched) % p256.Point.Fn.ORDER;
  const privateScalar = numberToBytesBE(
    reduced === 0n ? 1n : reduced,
    P256_SCALAR_BYTES
  );
  // Uncompressed SEC1 point: 0x04 || x || y.
  const publicPoint = p256.getPublicKey(privateScalar, false);
  const xB64 = base64url.encode(publicPoint.subarray(1, 1 + P256_SCALAR_BYTES));
  const yB64 = base64url.encode(publicPoint.subarray(1 + P256_SCALAR_BYTES));
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
