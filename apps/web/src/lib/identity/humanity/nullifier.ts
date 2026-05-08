/**
 * Humanity-credential cryptographic identifiers.
 *
 * Every value below is HMAC-derived with `HUMANITY_HMAC_SECRET` and a
 * domain-separation AAD prefix, so:
 *   - The raw provider nullifier never lands in the DB.
 *   - The stored subject hash never leaves the identity boundary.
 *   - Different RPs receive different per-RP pseudonyms by construction.
 *   - The stable-humanity id (across RPs, within Zentity) commits to the
 *     full set of active credentials, so attaching/detaching a provider
 *     deliberately rotates downstream pseudonyms.
 */

import "server-only";

import { env } from "@/env";
import { hmacSha256Hex } from "@/lib/privacy/primitives/symmetric";

const SUBJECT_AAD = "zentity:humanity:subject:v1";
const STABLE_ID_AAD = "zentity:humanity:stable_id:v1";
const RP_UNIQUE_AAD = "zentity:humanity:rp_unique:v1";

export function requireHumanityHmacSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      "HUMANITY_HMAC_SECRET is required for humanity credentials"
    );
  }
  return secret;
}

/**
 * Compute the stored `provider_subject_hash` for a freshly verified proof.
 * The raw `providerSubject` (e.g. World ID nullifier) MUST NOT be persisted.
 */
export function computeHumanityCredentialSubjectHash(args: {
  provider: string;
  providerSubject: string;
  providerSubjectKind: string;
  secret: string;
}): string {
  return hmacSha256Hex(args.secret, [
    SUBJECT_AAD,
    args.provider,
    args.providerSubjectKind,
    args.providerSubject,
  ]);
}

/**
 * Derive the user's stable humanity identifier from the union of active
 * credentials. Sorted-then-HMAC means the value is order-independent.
 *
 * Adding or removing a credential intentionally rotates this id (and all
 * per-RP pseudonyms derived from it). RPs that need stability across
 * provider changes should request `proof:sybil` instead.
 */
function computeStableHumanityId(args: {
  providerSubjectHashes: readonly string[];
  secret: string;
}): string {
  const sorted = [...args.providerSubjectHashes].sort();
  return hmacSha256Hex(args.secret, [STABLE_ID_AAD, ...sorted]);
}

/**
 * Derive the per-RP humanity pseudonym shipped to a relying party in
 * the access token's `rp_unique_humanity_id` claim.
 *
 * Two RPs holding two different `clientId`s receive two different values
 * for the same user. Two access tokens issued to the same RP for the same
 * user receive the same value.
 */
function computeRpUniqueHumanityId(args: {
  clientId: string;
  secret: string;
  stableHumanityId: string;
}): string {
  return hmacSha256Hex(args.secret, [
    RP_UNIQUE_AAD,
    args.stableHumanityId,
    args.clientId,
  ]);
}

/**
 * Convenience: resolve the full per-RP humanity claim payload from a
 * user's set of active provider-subject hashes.
 */
export function resolveRpUniqueHumanityClaim(args: {
  clientId: string;
  providerSubjectHashes: readonly string[];
}): { rp_unique_humanity_id: string } | null {
  if (args.providerSubjectHashes.length === 0) {
    return null;
  }

  const secret = requireHumanityHmacSecret(env.HUMANITY_HMAC_SECRET);
  const stableHumanityId = computeStableHumanityId({
    providerSubjectHashes: args.providerSubjectHashes,
    secret,
  });
  return {
    rp_unique_humanity_id: computeRpUniqueHumanityId({
      clientId: args.clientId,
      secret,
      stableHumanityId,
    }),
  };
}
