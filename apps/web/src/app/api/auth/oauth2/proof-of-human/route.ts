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
 * The PoH token asserts orthogonal axes about the user, without PII:
 *   - `poh.identity`  — was the user's real-world identity proven? how strong?
 *   - `poh.humanity`  — has any external provider attested they are unique?
 *   - `poh.policy`    — version + canonical 7-check booleans
 *
 * `identity.method` (OCR vs NFC) is intentionally omitted: forwarding it
 * lets RPs discriminate by verification path, which is a privacy regression
 * for users on the OCR track. Clients that genuinely need the method can
 * request `proof:verification` separately.
 *
 * The token is forward-portable: an RP can hand it to a downstream service
 * and the downstream verifies the issuer signature plus the DPoP `cnf`.
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
  const compliance = model.compliance;

  // Reject only when the user has no signal at all. A user with humanity
  // alone (`identity.verified=false, humanity.proven=true`) still gets a
  // token — RPs that require verified identity gate on `identity.verified`.
  if (!(compliance.identity.verified || compliance.humanity.proven)) {
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
      identity: {
        verified: compliance.identity.verified,
        strength: compliance.identity.strength,
      },
      humanity: {
        proven: compliance.humanity.proven,
      },
      policy: {
        version: compliance.policy.version,
      },
    },
  });

  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store" } }
  );
}
