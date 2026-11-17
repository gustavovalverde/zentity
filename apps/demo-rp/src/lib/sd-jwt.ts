import type { Hasher, SdJwtInstance, SdJwtPayload } from "@sd-jwt/core";

/**
 * Disclosure digest hasher for `_sd_alg: sha-256`, the algorithm Zentity
 * issues with. Any other algorithm is refused rather than hashed as SHA-256.
 */
export const sha256Hasher: Hasher = async (data, alg) => {
  if (alg !== "sha-256") {
    throw new Error(`Unsupported SD-JWT digest algorithm: ${alg}`);
  }
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
};

/**
 * Returns the top-level claims an SD-JWT selectively discloses, without the
 * claims the issuer always shows (`iss`, `vct`, `cnf`, `status`, and so on).
 */
export async function readDisclosedClaims(
  sdjwt: Pick<SdJwtInstance<SdJwtPayload>, "getClaims" | "presentableKeys">,
  encoded: string
): Promise<Record<string, unknown>> {
  const [claims, disclosedKeys] = await Promise.all([
    sdjwt.getClaims(encoded),
    sdjwt.presentableKeys(encoded),
  ]);
  return Object.fromEntries(
    disclosedKeys
      .filter((key) => Object.hasOwn(claims, key))
      .map((key) => [key, claims[key]])
  );
}
