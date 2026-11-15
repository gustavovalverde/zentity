import "server-only";

import {
  createDpopClientFromKeyPair,
  type DpopClient,
  type DpopKeyPair as DpopJwkPair,
  deriveDpopKeyPairFromSeed,
  generateDpopKeyPair,
} from "@zentity/sdk/rp";
import {
  type DpopKeyPair,
  deriveDpopKeyJkt,
} from "better-auth/oauth2/dpop-client";

import { env } from "@/lib/env";

/**
 * The DPoP key behind every Zentity sign-in token. Generic OAuth signs the
 * authorization code exchange and refresh with `keyPair` and binds the code
 * to it through `dpop_jkt`; userinfo, the agent bootstrap token exchange,
 * validity, and Proof-of-Human present those tokens through `client`, which
 * holds the same key.
 *
 * Stored tokens are bound to this key, so it is derived from
 * `OAUTH_DPOP_KEY_SEED`: every instance and cold start gets the same `jkt`.
 * The payment channel has its own key (`zpay-dpop.ts`).
 */
interface OAuthDpopKey {
  client: DpopClient;
  jkt: string;
  keyPair: DpopKeyPair;
}

const ES256_KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

let keyPromise: Promise<OAuthDpopKey> | null = null;

function loadJwkPair(): Promise<DpopJwkPair> {
  const seed = env.OAUTH_DPOP_KEY_SEED;
  if (seed) {
    if (seed === env.ZPAY_DPOP_KEY_SEED) {
      throw new Error(
        "OAUTH_DPOP_KEY_SEED must differ from ZPAY_DPOP_KEY_SEED; the same seed derives the same DPoP key"
      );
    }
    return deriveDpopKeyPairFromSeed(seed);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("OAUTH_DPOP_KEY_SEED is required in production");
  }
  process.stderr.write(
    "OAUTH_DPOP_KEY_SEED unset; ephemeral sign-in DPoP key. Stored Zentity tokens stop working when the process restarts. Set the seed to keep them.\n"
  );
  return generateDpopKeyPair();
}

async function loadKey(): Promise<OAuthDpopKey> {
  const jwks = await loadJwkPair();
  const [client, privateKey, publicKey] = await Promise.all([
    createDpopClientFromKeyPair(jwks),
    crypto.subtle.importKey(
      "jwk",
      jwks.privateJwk,
      ES256_KEY_ALGORITHM,
      false,
      ["sign"]
    ),
    // The proof header embeds the public JWK, so the key stays extractable.
    crypto.subtle.importKey("jwk", jwks.publicJwk, ES256_KEY_ALGORITHM, true, [
      "verify",
    ]),
  ]);
  const keyPair = { privateKey, publicKey };
  return { client, jkt: await deriveDpopKeyJkt(keyPair), keyPair };
}

function getKey(): Promise<OAuthDpopKey> {
  if (!keyPromise) {
    keyPromise = loadKey();
    keyPromise.catch(() => {
      keyPromise = null;
    });
  }
  return keyPromise;
}

/** The key pair for generic OAuth's `dpop` option. Always the same object. */
export async function getOAuthDpopKeyPair(): Promise<DpopKeyPair> {
  return (await getKey()).keyPair;
}

/** The SDK DPoP client for requests that present a sign-in token. */
export async function getOAuthDpopClient(): Promise<DpopClient> {
  return (await getKey()).client;
}

/** The JWK thumbprint Zentity puts in `cnf.jkt` of sign-in tokens. */
export async function getOAuthDpopJkt(): Promise<string> {
  return (await getKey()).jkt;
}
