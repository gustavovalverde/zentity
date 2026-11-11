import "server-only";

import type { AuthContext } from "@better-auth/core";

import {
  createDpopNonce,
  createDpopReplayStore,
  DPOP_NONCE_HEADER,
  type DpopNonceOptions,
  type DpopProofErrorCode,
  isDpopProofError,
  verifyDpopProof,
} from "@better-auth/core/oauth2";
import { HAIP_DPOP_SIGNING_ALGORITHMS } from "@better-auth/haip";
import { APIError } from "better-auth/api";

/**
 * Seconds a server-provided DPoP nonce (RFC 9449 §8) is accepted after it is
 * issued. Every DPoP endpoint on Zentity's origin shares this lifetime and the
 * auth secret, because clients keep one nonce per origin.
 */
export const DPOP_NONCE_EXPIRES_IN_SECONDS = 300;

/** The nonce settings every Zentity DPoP endpoint verifies proofs against. */
export function dpopNonceOptions(secret: string): DpopNonceOptions {
  return { secret, expiresIn: DPOP_NONCE_EXPIRES_IN_SECONDS };
}

/**
 * Headers that hand the client the next DPoP nonce (RFC 9449 §8.2). A cached
 * response would hand out the nonce after it expires, so it is `no-store`.
 */
export async function nextDpopNonceHeaders(
  secret: string
): Promise<Record<string, string>> {
  return {
    [DPOP_NONCE_HEADER]: await createDpopNonce({ secret }),
    "Cache-Control": "no-store",
  };
}

export type DpopProofCheck =
  | { jkt: string | undefined; ok: true }
  | { code: DpopProofErrorCode; error: string; ok: false };

/**
 * Verifies the DPoP proof (RFC 9449 §4.3) on a request to a Zentity endpoint
 * that binds a key outside the token endpoint, such as the first-party
 * authorization challenge: signature, `typ`, ES256, `htm` and `htu` for this
 * request, the `iat` window, a current server-provided nonce, and a `jti`
 * reserved in the database so the proof cannot be replayed. Only a verified
 * proof yields a key thumbprint; a request without a proof yields none. A
 * proof without a current nonce fails with `use_dpop_nonce` before its `jti`
 * is reserved, so the client can retry with the nonce.
 */
export async function verifyRequestDpopProof(input: {
  context: Pick<AuthContext, "internalAdapter" | "secret">;
  method: string;
  proofJwt: string | null | undefined;
  url: string;
}): Promise<DpopProofCheck> {
  if (!input.proofJwt) {
    return { ok: true, jkt: undefined };
  }
  try {
    const proof = await verifyDpopProof({
      proofJwt: input.proofJwt,
      method: input.method,
      url: input.url,
      signingAlgorithms: HAIP_DPOP_SIGNING_ALGORITHMS,
      replayStore: createDpopReplayStore(input.context.internalAdapter),
      nonce: dpopNonceOptions(input.context.secret),
    });
    return { ok: true, jkt: proof.jkt };
  } catch (error) {
    if (isDpopProofError(error)) {
      return { ok: false, code: error.code, error: error.message };
    }
    throw error;
  }
}

/**
 * Answers a token request whose DPoP proof is valid but lacks a current nonce
 * with `use_dpop_nonce` and the nonce to retry with (RFC 9449 §8), without
 * reserving the proof's `jti`. Zentity's token hooks run this before any hook
 * that stages state for the grant, such as the identity release an
 * authorization code carries or the CIBA token stash: the provider would
 * refuse the same request after those hooks ran, and the client's retry
 * redeems the same grant. Any other proof failure is left to the provider.
 */
export async function challengeMissingTokenDpopNonce(input: {
  proofJwt: string | null | undefined;
  secret: string;
  url: string;
}): Promise<void> {
  if (!input.proofJwt) {
    return;
  }
  try {
    await verifyDpopProof({
      proofJwt: input.proofJwt,
      method: "POST",
      url: input.url,
      signingAlgorithms: HAIP_DPOP_SIGNING_ALGORITHMS,
      nonce: dpopNonceOptions(input.secret),
    });
  } catch (error) {
    if (!isDpopProofError(error)) {
      throw error;
    }
    if (error.code === "use_dpop_nonce") {
      throw new APIError(
        "BAD_REQUEST",
        { error: error.code, error_description: error.message },
        await nextDpopNonceHeaders(input.secret)
      );
    }
  }
}
