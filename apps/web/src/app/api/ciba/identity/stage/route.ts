import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { storeEphemeralClaims } from "@/lib/auth/oidc/ephemeral-identity-claims";
import {
  IdentityFieldsSchema,
  normalizeIdentityFields,
} from "@/lib/auth/oidc/identity-fields-schema";
import {
  createScopeHash,
  verifyIdentityIntentToken,
} from "@/lib/auth/oidc/identity-intent";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
} from "@/lib/auth/oidc/identity-scopes";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

const StageSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  identity: IdentityFieldsSchema.optional(),
  intent_token: z.string().min(1),
});

/**
 * POST /api/ciba/identity/stage — Stage identity claims for a CIBA request.
 *
 * Parallel to /api/oauth2/identity/stage but uses auth_req_id instead of
 * oauth_query to look up the client context. The staged claims are consumed
 * by customIdTokenClaims when the CIBA grant handler mints tokens.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = StageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { auth_req_id, scopes, identity, intent_token } = parsed.data;

  // Look up the CIBA request for context
  const cibaRequest = await db
    .select({
      clientId: cibaRequests.clientId,
      userId: cibaRequests.userId,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, auth_req_id))
    .get();

  if (!cibaRequest) {
    return NextResponse.json({ error: "Unknown auth_req_id" }, { status: 404 });
  }

  if (cibaRequest.userId !== session.user.id) {
    return NextResponse.json(
      { error: "CIBA request does not belong to current user" },
      { status: 403 }
    );
  }

  if (cibaRequest.status !== "pending") {
    return NextResponse.json(
      { error: "CIBA request is no longer pending" },
      { status: 400 }
    );
  }

  // Verify scopes are within the CIBA request
  const cibaScopes = new Set(cibaRequest.scope.split(" "));
  for (const scope of scopes) {
    if (!cibaScopes.has(scope)) {
      return NextResponse.json(
        { error: `Scope not in CIBA request: ${scope}` },
        { status: 400 }
      );
    }
  }

  const identityScopes = extractIdentityScopes(scopes);
  if (identityScopes.length === 0) {
    return NextResponse.json({ staged: false });
  }

  // Verify the intent token
  let intentPayload: Awaited<ReturnType<typeof verifyIdentityIntentToken>>;
  try {
    intentPayload = await verifyIdentityIntentToken(intent_token);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired intent token" },
      { status: 400 }
    );
  }

  if (intentPayload.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Intent token does not match current user" },
      { status: 403 }
    );
  }

  const scopeHash = createScopeHash(scopes);
  if (
    intentPayload.clientId !== cibaRequest.clientId ||
    intentPayload.scopeHash !== scopeHash
  ) {
    return NextResponse.json(
      { error: "Intent token does not match request context" },
      { status: 400 }
    );
  }

  const normalizedIdentity = normalizeIdentityFields(identity ?? {});
  const filteredIdentity = filterIdentityByScopes(
    normalizedIdentity,
    identityScopes
  );

  if (Object.keys(filteredIdentity).length === 0) {
    return NextResponse.json({ staged: false });
  }

  const stored = await storeEphemeralClaims(
    session.user.id,
    filteredIdentity,
    scopes,
    {
      clientId: cibaRequest.clientId,
      scopeHash,
      intentJti: intentPayload.jti,
    }
  );

  if (!stored.ok) {
    if (stored.reason === "intent_reused") {
      return NextResponse.json(
        { error: "Identity intent token has already been used" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "An active identity stage already exists for this user" },
      { status: 409 }
    );
  }

  return NextResponse.json({ staged: true });
}
