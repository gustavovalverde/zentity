import "server-only";

import {
  createDpopClient,
  createDpopClientFromSeed,
  type DpopClient,
} from "@zentity/sdk/rp";

import { env } from "@/lib/env";

/**
 * The single DPoP client for the zpay payment channel: `/prepare`, the wallet
 * `/sign`, and `/settle`. One key binds the whole chain — the issuer pins the
 * payment token's `cnf.jkt` to whichever key makes the CIBA token request, and
 * the wallet then requires the `/sign` proof to use that same key (PRD-43 Open
 * Question 3).
 *
 * When `ZPAY_DPOP_KEY_SEED` is set the key is derived deterministically via the
 * SDK (HKDF → P-256), so every BFF replica and cold start lands on the same
 * `jkt`. Unset (dev only) → an ephemeral key, with a warning that the `jkt`
 * drifts across restarts. The HKDF math, formerly duplicated in
 * `lib/dpop.ts`, now lives once in `@zentity/sdk/rp` (`createDpopClientFromSeed`).
 */

let clientPromise: Promise<DpopClient> | null = null;
let missingSeedWarned = false;

export function getZpayDpopClient(): Promise<DpopClient> {
  if (!clientPromise) {
    if (env.ZPAY_DPOP_KEY_SEED) {
      clientPromise = createDpopClientFromSeed(env.ZPAY_DPOP_KEY_SEED);
    } else {
      if (!missingSeedWarned && process.env.NODE_ENV !== "production") {
        missingSeedWarned = true;
        process.stderr.write(
          "ZPAY_DPOP_KEY_SEED unset; ephemeral DPoP key. /settle and the wallet /sign binding will drift across process restarts. Set the seed to match zpay docker-compose.\n"
        );
      }
      clientPromise = createDpopClient();
    }
  }
  return clientPromise;
}

/** Test seam: drop the cached client so the next call re-derives. */
export function __resetZpayDpopClientForTests(): void {
  clientPromise = null;
  missingSeedWarned = false;
}
