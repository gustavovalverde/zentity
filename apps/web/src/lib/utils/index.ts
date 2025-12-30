/**
 * Utility Module - Client-Safe Exports
 *
 * This barrel file only exports modules that are safe for client components.
 * For server-only utilities (env, service-urls), import directly from
 * the specific module files.
 */

// Base64 encoding/decoding (client-safe)
export { base64ToBytes, bytesToBase64 } from "./base64";
export {
  base64UrlToBytes,
  bytesToBase64Url,
} from "./base64url";
// HTTP client utilities (client-safe)
export { fetchJson, HttpError } from "./http";

// Image utilities (client-safe)

export { resizeImageFile } from "./image";
// Motion/animation presets (client-safe)
export { motion, reducedMotion } from "./motion";
// Name utilities (client-safe)
export {
  buildDisplayName,
  getFirstPart,
} from "./name-utils";
// Class name utilities (client-safe)
export { cn } from "./utils";
// Form validation (client-safe)
export { makeFieldValidator } from "./validation";
