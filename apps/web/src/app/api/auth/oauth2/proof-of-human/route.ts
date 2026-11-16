import "server-only";

import { NextResponse } from "next/server";

import {
  mintProofOfHuman,
  type ProofOfHumanMintResult,
} from "@/lib/auth/oidc/proof-of-human";
import {
  insufficientScope,
  invalidAccessToken,
} from "@/lib/auth/oidc/resource-challenge";
import {
  resolveProtectedResourcePrincipal,
  resourceErrorResponse,
  withNextDpopNonce,
} from "@/lib/auth/oidc/resource-principal";

/**
 * POST /api/auth/oauth2/proof-of-human
 *
 * Mints a DPoP-bound Proof-of-Human token (`typ: poh+jwt`) for an access
 * token with the `poh` scope. A token from an `x402_purchase` approval yields
 * one merchant-audienced token per approval; any other token yields a token
 * for its own client. `mintProofOfHuman` describes both modes.
 */
export async function POST(request: Request) {
  const resolved = await resolveProtectedResourcePrincipal(request);
  if (!resolved.ok) {
    return resourceErrorResponse(resolved.error);
  }
  return withNextDpopNonce(
    respond(request, await mintProofOfHuman(resolved.principal)),
    resolved.dpopNonce
  );
}

function respond(
  request: Request,
  result: ProofOfHumanMintResult
): NextResponse {
  if (result.ok) {
    return NextResponse.json(
      {
        token: result.token,
        token_type: "DPoP",
        expires_in: result.expiresIn,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  switch (result.error) {
    case "insufficient_scope":
      return resourceErrorResponse(insufficientScope(["poh"]));
    case "not_verified":
      return NextResponse.json({ error: "not_verified" }, { status: 403 });
    default:
      return resourceErrorResponse(
        invalidAccessToken(request, "This approval is no longer usable")
      );
  }
}
