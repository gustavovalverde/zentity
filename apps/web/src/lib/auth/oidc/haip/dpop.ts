import "server-only";

import {
  createDpopReplayStore,
  type DpopReplayReservations,
  isDpopProofError,
  verifyDpopProof,
} from "@better-auth/core/oauth2";
import { HAIP_DPOP_SIGNING_ALGORITHMS } from "@better-auth/haip";

export type DpopProofCheck =
  | { jkt: string | undefined; ok: true }
  | { error: string; ok: false };

/**
 * Verifies the DPoP proof (RFC 9449 §4.3) on a request to a Zentity endpoint
 * that binds a key outside the token endpoint, such as the first-party
 * authorization challenge: signature, `typ`, ES256, `htm` and `htu` for this
 * request, the `iat` window, and a `jti` reserved in the database so the proof
 * cannot be replayed. Only a verified proof yields a key thumbprint; a request
 * without a proof yields none.
 */
export async function verifyRequestDpopProof(input: {
  method: string;
  proofJwt: string | null | undefined;
  reservations: DpopReplayReservations;
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
      replayStore: createDpopReplayStore(input.reservations),
    });
    return { ok: true, jkt: proof.jkt };
  } catch (error) {
    if (isDpopProofError(error)) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
