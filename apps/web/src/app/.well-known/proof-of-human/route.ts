import { env } from "@/env";

const TRAILING_SLASHES = /\/+$/;

/**
 * Proof-of-Human Issuer Discovery
 *
 * Allows x402 resource servers and agents to auto-discover
 * the PoH endpoint, verification capabilities, and JWKS.
 */
export function GET() {
  const issuer = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");

  const metadata = {
    issuer,
    poh_endpoint: `${issuer}/api/auth/oauth2/proof-of-human`,
    jwks_uri: `${issuer}/api/auth/oauth2/jwks`,
    tiers_supported: [1, 2, 3, 4],
    sybil_methods: ["document_dedup", "nfc_nullifier"],
    token_signing_alg: "EdDSA",
    dpop_signing_alg_values_supported: ["ES256"],
    x402_compatible: true,
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
