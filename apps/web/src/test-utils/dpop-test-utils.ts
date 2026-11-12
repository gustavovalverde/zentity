import crypto from "node:crypto";

import { createDpopNonce, DPOP_NONCE_HEADER } from "@better-auth/core/oauth2";
import { createDpopClientFromKeyPair, type DpopClient } from "@zentity/sdk/rp";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { vi } from "vitest";

import { auth } from "@/lib/auth/auth-config";

const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";

export interface DpopKeyPair {
  jwk: JWK;
  privateJwk: JWK;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function createTestDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  return {
    privateKey,
    publicKey,
    jwk: await exportJWK(publicKey),
    privateJwk: await exportJWK(privateKey),
  };
}

/** A nonce as Zentity's `DPoP-Nonce` header hands it out right now. */
export async function currentDpopNonce(): Promise<string> {
  return createDpopNonce({ secret: (await auth.$context).secret });
}

/** A nonce minted with another secret, which this server never issued. */
export function foreignDpopNonce(): Promise<string> {
  return createDpopNonce({
    secret: crypto.randomBytes(32).toString("base64url"),
  });
}

/** A nonce this server issued longer ago than nonces stay valid. */
export async function staleDpopNonce(): Promise<string> {
  const expiresIn = (await auth.$context).getPlugin("oauth-provider")?.options
    .dpop?.nonce?.expiresIn;
  if (!expiresIn) {
    throw new Error("the OAuth provider must set a DPoP nonce lifetime");
  }
  const issuedAt = Date.now() - (expiresIn + 60) * 1000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
  try {
    return await currentDpopNonce();
  } finally {
    clock.mockRestore();
  }
}

/**
 * Signs a DPoP proof. It carries a current server nonce, as from a client that
 * already holds one, unless `options.nonce` names another nonce or is `null`
 * for none.
 */
export async function buildDpopProof(
  keyPair: DpopKeyPair,
  method: string,
  url: string,
  accessToken?: string,
  options: { nonce?: string | null } = {}
): Promise<string> {
  const nonce =
    options.nonce === undefined ? await currentDpopNonce() : options.nonce;
  // Resource requests bind the proof to the presented access token via `ath`
  // (RFC 9449 §4.2); token-endpoint proofs omit it (no token yet).
  const ath = accessToken
    ? crypto.createHash("sha256").update(accessToken).digest("base64url")
    : undefined;
  return new SignJWT({
    htm: method,
    htu: url,
    jti: crypto.randomUUID(),
    ...(ath ? { ath } : {}),
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: keyPair.jwk,
    })
    .setIssuedAt()
    .sign(keyPair.privateKey);
}

/**
 * An SDK DPoP client for the key pair that sends requests straight to the auth
 * handler, so it answers the server's nonce challenges as real clients do.
 */
export function createAuthHandlerDpopClient(
  keyPair: DpopKeyPair
): Promise<DpopClient> {
  return createDpopClientFromKeyPair({
    privateJwk: keyPair.privateJwk,
    publicJwk: keyPair.jwk,
  });
}

/** Sends a request to the auth handler, as the SDK's `fetch` transport. */
export function authHandlerFetch(
  url: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  return auth.handler(new Request(url, init));
}

function parseResponseJson(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  // Unwrap better-auth's { response: ... } envelope
  return parsed && typeof parsed === "object" && "response" in parsed
    ? (parsed.response as Record<string, unknown>)
    : parsed;
}

interface TokenResult {
  dpopKeyPair: DpopKeyPair;
  json: Record<string, unknown>;
  status: number;
}

/**
 * Sends a DPoP-bound token request to the auth handler through the SDK client,
 * with an ephemeral key pair or the given one. The first proof carries no
 * nonce, so the request is retried once with the nonce the server returns
 * (RFC 9449 §8).
 */
export async function postTokenWithDpop(
  body: Record<string, string>,
  keyPair?: DpopKeyPair
): Promise<TokenResult> {
  const dpopKeyPair = keyPair ?? (await createTestDpopKeyPair());
  const client = await createAuthHandlerDpopClient(dpopKeyPair);
  const response = await client.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    fetch: authHandlerFetch,
  });

  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = parseResponseJson(text);
    } catch {
      json = { raw: text };
    }
  }

  return { status: response.status, json, dpopKeyPair };
}

/**
 * Where a refused nonce surfaces: an authorization server answers 400 with
 * the error in its JSON body, a resource server 401 with a `DPoP` challenge.
 */
export type DpopNonceChallengeKind = "authorization_server" | "resource_server";

const USE_DPOP_NONCE_CHALLENGE = /^DPoP error="use_dpop_nonce"/;

function describeResponse(response: Response, body: string): string {
  const headers = JSON.stringify(Object.fromEntries(response.headers));
  return `${response.status} ${body} ${headers}`;
}

function hasNoStoreNonce(response: Response): boolean {
  return Boolean(
    response.headers.get(DPOP_NONCE_HEADER) &&
      response.headers.get("Cache-Control")?.includes("no-store")
  );
}

/**
 * Returns the nonce a `use_dpop_nonce` challenge (RFC 9449 §8, §9) hands out,
 * and throws when `response` is anything else.
 */
export async function readDpopNonceChallenge(
  response: Response,
  kind: DpopNonceChallengeKind
): Promise<string> {
  const body = await response.clone().text();
  const challenged =
    kind === "authorization_server"
      ? response.status === 400 &&
        (JSON.parse(body) as { error?: unknown }).error === "use_dpop_nonce"
      : response.status === 401 &&
        USE_DPOP_NONCE_CHALLENGE.test(
          response.headers.get("WWW-Authenticate") ?? ""
        );
  if (!(challenged && hasNoStoreNonce(response))) {
    throw new Error(
      `expected a use_dpop_nonce challenge with a DPoP-Nonce, got ${describeResponse(response, body)}`
    );
  }
  return response.headers.get(DPOP_NONCE_HEADER) as string;
}

/**
 * Returns the next nonce an accepted response hands out (RFC 9449 §8.2), and
 * throws when the request was refused or the nonce is missing.
 */
export async function readAcceptedDpopNonce(
  response: Response,
  accepts: (response: Response) => Promise<boolean>
): Promise<string> {
  if (!((await accepts(response.clone())) && hasNoStoreNonce(response))) {
    const body = await response.clone().text();
    throw new Error(
      `expected an accepted response with the next DPoP-Nonce, got ${describeResponse(response, body)}`
    );
  }
  return response.headers.get(DPOP_NONCE_HEADER) as string;
}

/** Accepts a response with one of `statuses`. */
export function hasStatus(
  ...statuses: number[]
): (response: Response) => Promise<boolean> {
  return async (response) => statuses.includes(response.status);
}

/** Sends one request whose DPoP proof carries `nonce`, or none for `null`. */
type NonceSender = (nonce: string | null) => Promise<Response>;

/**
 * Runs the RFC 9449 §8 nonce round trip against one endpoint, and throws at
 * the first step that differs:
 *
 * 1. A proof without a nonce gets the challenge and a `DPoP-Nonce`.
 * 2. The retry with that nonce is accepted and carries the next nonce.
 * 3. A new request with the next nonce is accepted on its first try.
 * 4. A nonce from another secret, or one that has expired, gets the challenge,
 *    and the request is still accepted afterwards with a current nonce, so a
 *    refused proof consumes nothing.
 *
 * `prepare` returns a sender for a fresh request; for a one-time grant such
 * as an authorization code it mints a new grant on every call.
 */
export async function runDpopNonceRoundTrip(input: {
  accepts: (response: Response) => Promise<boolean>;
  kind: DpopNonceChallengeKind;
  prepare: () => Promise<NonceSender>;
}): Promise<void> {
  const send = await input.prepare();
  const nonce = await readDpopNonceChallenge(await send(null), input.kind);
  const next = await readAcceptedDpopNonce(await send(nonce), input.accepts);

  const sendNext = await input.prepare();
  await readAcceptedDpopNonce(await sendNext(next), input.accepts);

  const sendRefused = await input.prepare();
  await readDpopNonceChallenge(
    await sendRefused(await foreignDpopNonce()),
    input.kind
  );
  await readDpopNonceChallenge(
    await sendRefused(await staleDpopNonce()),
    input.kind
  );
  await readAcceptedDpopNonce(
    await sendRefused(await currentDpopNonce()),
    input.accepts
  );
}
