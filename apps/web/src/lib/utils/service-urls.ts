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

export function getSignerCoordinatorUrl(): string {
  return normalizeServiceUrl(
    process.env.SIGNER_COORDINATOR_URL || "http://localhost:5002"
  );
}

export function getSignerEndpoints(): string[] {
  const raw =
    process.env.SIGNER_ENDPOINTS ||
    "http://localhost:5101,http://localhost:5102,http://localhost:5103";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalizeServiceUrl(entry));
}
