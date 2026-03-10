import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { createIdentityIntentToken } from "@/lib/auth/oidc/identity-intent";
import { extractIdentityScopes } from "@/lib/auth/oidc/identity-scopes";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

const IntentSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

/**
 * POST /api/ciba/identity/intent — Issue a CIBA-specific intent token.
 *
 * Binds the intent to an auth_req_id (instead of an OAuth signed query).
 * The CIBA request provides clientId and scope context.
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

  const parsed = IntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { auth_req_id, scopes } = parsed.data;

  // Look up the CIBA request to get clientId and verify the user matches
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

  // Verify requested scopes are within the CIBA request's scope
  const cibaScopes = new Set(cibaRequest.scope.split(" "));
  for (const scope of scopes) {
    if (!cibaScopes.has(scope)) {
      return NextResponse.json(
        { error: `Scope not in CIBA request: ${scope}` },
        { status: 400 }
      );
    }
  }

  if (extractIdentityScopes(scopes).length === 0) {
    return NextResponse.json(
      { error: "At least one identity scope is required" },
      { status: 400 }
    );
  }

  const intent = await createIdentityIntentToken({
    userId: session.user.id,
    clientId: cibaRequest.clientId,
    scopes,
  });

  return NextResponse.json({
    intent_token: intent.intentToken,
    expires_at: intent.expiresAt,
  });
}
