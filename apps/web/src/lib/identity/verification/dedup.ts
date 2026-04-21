import { createHmac } from "node:crypto";

import { encodeAad } from "@/lib/privacy/primitives/symmetric";

const DEDUP_KEY_AAD = "zentity:dedup-key:v1";
const RP_NULLIFIER_AAD = "zentity:rp-nullifier:v1";
const NULLIFIER_SEED_AAD = "zentity:nullifier-seed:v1";

export const NULLIFIER_SEED_SOURCE = {
  OCR: "ocr:document",
  NFC: "nfc:chip",
} as const;

type NullifierSeedSource =
  (typeof NULLIFIER_SEED_SOURCE)[keyof typeof NULLIFIER_SEED_SOURCE];

/**
 * Canonical normalization for document numbers.
 * Strips all non-alphanumeric characters and uppercases.
 */
function canonicalizeDocumentNumber(docNumber: string): string {
  return docNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function hmacHex(secret: string, parts: string[]): string {
  return createHmac("sha256", secret).update(encodeAad(parts)).digest("hex");
}

/**
 * Compute a deterministic dedup key from identity attributes.
 *
 * The same identity always produces the same key regardless of session,
 * verification method (OCR vs NFC), or timing.
 */
export function computeDedupKey(
  secret: string,
  docNumber: string,
  issuerCountry: string,
  dob: string
): string {
  return hmacHex(secret, [
    DEDUP_KEY_AAD,
    canonicalizeDocumentNumber(docNumber),
    issuerCountry.toUpperCase(),
    dob,
  ]);
}

/**
 * Compute a per-RP sybil nullifier.
 *
 * Same person + same RP = same nullifier (enables RP-level one-identity enforcement).
 * Same person + different RP = different nullifier (no cross-RP linkability).
 */
export function computeRpNullifier(
  secret: string,
  nullifierSeed: string,
  clientId: string
): string {
  return hmacHex(secret, [RP_NULLIFIER_AAD, nullifierSeed, clientId]);
}

/**
 * Derive the account-scoped nullifier seed from a raw identifier.
 *
 * Domain separation by `source` prevents a raw third-party identifier (e.g. a
 * ZKPassport chip nullifier) from surfacing verbatim in `identity_bundles` as
 * the seed used for per-RP nullifier derivation. Every `nullifier_seed` on the
 * bundle is a domain-separated HMAC, regardless of verification path.
 */
export function computeNullifierSeed(
  secret: string,
  rawKey: string,
  source: NullifierSeedSource
): string {
  return hmacHex(secret, [NULLIFIER_SEED_AAD, source, rawKey]);
}
