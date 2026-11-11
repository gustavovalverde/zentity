import { NextResponse } from "next/server";

import {
  extractIdentityScopes,
  hasAnyProofScope,
} from "@/lib/auth/oidc/disclosure/registry";
import {
  insufficientScope,
  resolveProtectedResourcePrincipal,
  resourceErrorResponse,
} from "@/lib/auth/oidc/resource-principal";
import { getRpValidityState } from "@/lib/identity/validity/rp-notice";

function hasValidityAccess(scopes: readonly string[]): boolean {
  return (
    scopes.includes("poh") ||
    hasAnyProofScope(scopes) ||
    extractIdentityScopes(scopes).length > 0
  );
}

export async function GET(request: Request): Promise<Response> {
  const resolved = await resolveProtectedResourcePrincipal(request);
  if (!resolved.ok) {
    return resourceErrorResponse(resolved.error);
  }
  const { principal } = resolved;

  if (!hasValidityAccess(principal.scopes)) {
    return resourceErrorResponse(
      insufficientScope(
        ["poh"],
        "access token needs the poh scope, a proof scope, or an identity scope"
      )
    );
  }

  const validityState = await getRpValidityState({
    clientId: principal.clientId,
    sub: principal.sub,
  });

  return NextResponse.json(validityState, {
    headers: { "Cache-Control": "no-store" },
  });
}
