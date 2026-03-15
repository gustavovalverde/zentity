import { createHmac } from "node:crypto";

/**
 * Canonical normalization for document numbers.
 * Strips all non-alphanumeric characters and uppercases.
 */
export function canonicalizeDocumentNumber(docNumber: string): string {
  return docNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Compute a deterministic dedup key from identity attributes.
 *
 * HMAC-SHA256(secret, canonical(doc_number) | "|" | issuer_country | "|" | dob)
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
  const canonical = canonicalizeDocumentNumber(docNumber);
  const input = `${canonical}|${issuerCountry.toUpperCase()}|${dob}`;
  return createHmac("sha256", secret).update(input).digest("hex");
}

/**
 * Compute a per-RP sybil nullifier.
 *
 * HMAC-SHA256(secret, dedup_key | "|rp|" | client_id)
 *
 * Same person + same RP = same nullifier (enables RP-level one-identity enforcement).
 * Same person + different RP = different nullifier (no cross-RP linkability).
 */
export function computeRpNullifier(
  secret: string,
  dedupKey: string,
  clientId: string
): string {
  return createHmac("sha256", secret)
    .update(`${dedupKey}|rp|${clientId}`)
    .digest("hex");
}
