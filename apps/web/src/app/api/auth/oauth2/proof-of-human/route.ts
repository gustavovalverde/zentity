import "server-only";

import { NextResponse } from "next/server";

import { env } from "@/env";
import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import { resolveProtectedResourcePrincipal } from "@/lib/auth/oidc/resource-principal";
import { getVerificationReadModel } from "@/lib/identity/verification/read-model";

const TRAILING_SLASHES = /\/+$/;

/**
 * POST /api/auth/oauth2/proof-of-human
 *
 * Issues a compact, DPoP-bound Proof-of-Human JWT.
 * Requires an access token with the `poh` scope.
 *
 * The PoH token asserts the user's verification tier without PII:
 * - `poh.tier` — numeric assurance level (1–4)
 * - `poh.verified` — whether the user meets full compliance
 * - `poh.sybil_resistant` — whether a uniqueness check passed
 */
export async function POST(request: Request) {
  const principal = await resolveProtectedResourcePrincipal(request);

  if (!principal) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  if (!principal.scopes.includes("poh")) {
    return NextResponse.json({ error: "insufficient_scope" }, { status: 403 });
  }

  const model = await getVerificationReadModel(principal.userId);

  if (!model.verificationId) {
    return NextResponse.json({ error: "not_verified" }, { status: 403 });
  }

  // Use the access token's sub (already pairwise if client is configured for it)
  const sub = principal.sub;
  const now = Math.floor(Date.now() / 1000);
  const issuer = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");

  const token = await signJwt({
    iss: issuer,
    sub,
    iat: now,
    exp: now + 3600,
    scope: "poh",
    cnf: { jkt: principal.dpopJkt },
    poh: {
      tier: model.compliance.numericLevel,
      verified: model.compliance.verified,
      sybil_resistant: model.compliance.checks.sybilResistant,
    },
  });

  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store" } }
  );
}
