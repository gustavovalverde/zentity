import { NextResponse } from "next/server";

import {
  extractIdentityScopes,
  hasAnyProofScope,
} from "@/lib/auth/oidc/disclosure/registry";
import { resolveProtectedResourcePrincipal } from "@/lib/auth/oidc/resource-principal";
import { getRpValidityState } from "@/lib/identity/validity/rp-notice";

function hasValidityAccess(scopes: readonly string[]): boolean {
  return (
    scopes.includes("poh") ||
    hasAnyProofScope(scopes) ||
    extractIdentityScopes(scopes).length > 0
  );
}

export async function GET(request: Request): Promise<Response> {
  const principal = await resolveProtectedResourcePrincipal(request);
  if (!principal) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  if (!hasValidityAccess(principal.scopes)) {
    return NextResponse.json({ error: "insufficient_scope" }, { status: 403 });
  }

  const validityState = await getRpValidityState({
    clientId: principal.clientId,
    sub: principal.sub,
  });

  return NextResponse.json(validityState, {
    headers: { "Cache-Control": "no-store" },
  });
}
