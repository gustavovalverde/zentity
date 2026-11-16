import { IDENTITY_STRENGTHS } from "@zentity/sdk/protocol";

import { env } from "@/env";

const TRAILING_SLASHES = /\/+$/;

/**
 * Proof-of-Human issuer discovery: where x402 merchants and agents mint and
 * verify `poh+jwt` tokens, which identity strengths a merchant may require,
 * and how a token is presented.
 */
export function GET() {
  const issuer = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");

  const metadata = {
    issuer,
    poh_endpoint: `${issuer}/api/auth/oauth2/proof-of-human`,
    jwks_uri: `${issuer}/api/auth/oauth2/jwks`,
    identity_strengths_supported: [...IDENTITY_STRENGTHS],
    token_types_supported: ["poh+jwt"],
    presentation_methods_supported: ["dpop"],
    max_token_lifetime: 300,
    token_signing_alg: "EdDSA",
    dpop_signing_alg_values_supported: ["ES256"],
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
