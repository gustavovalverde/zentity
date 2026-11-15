import "server-only";

import { createHmac } from "node:crypto";

import { encodeAad } from "./symmetric";

/**
 * Length-prefixed HMAC-SHA256 helper.
 * Pairs with `encodeAad` so call sites stay collision-free.
 */
export function hmacSha256Hex(secret: string, parts: string[]): string {
  return createHmac("sha256", secret).update(encodeAad(parts)).digest("hex");
}
