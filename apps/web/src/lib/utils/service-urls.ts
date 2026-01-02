/** Matches one or more trailing slashes for URL normalization */
const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeServiceUrl(url: string): string {
  return url.replace(TRAILING_SLASHES_PATTERN, "");
}

export function getOcrServiceUrl(): string {
  return normalizeServiceUrl(
    process.env.OCR_SERVICE_URL || "http://localhost:5004"
  );
}

export function getFheServiceUrl(): string {
  return normalizeServiceUrl(
    process.env.FHE_SERVICE_URL || "http://localhost:5001"
  );
}
