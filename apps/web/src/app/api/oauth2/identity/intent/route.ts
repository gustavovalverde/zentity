import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { createIdentityIntentToken } from "@/lib/auth/oidc/identity-intent";
import { extractIdentityScopes } from "@/lib/auth/oidc/identity-scopes";
import {
  parseRequestedScopes,
  verifySignedOAuthQuery,
} from "@/lib/auth/oidc/oauth-query";

const IntentSchema = z.object({
  oauth_query: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

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

  const { oauth_query, scopes } = parsed.data;

  let queryParams: URLSearchParams;
  try {
    queryParams = await verifySignedOAuthQuery(oauth_query);
  } catch {
    return NextResponse.json({ error: "Invalid OAuth query" }, { status: 400 });
  }

  const clientId = queryParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "Missing client_id" }, { status: 400 });
  }

  const requestedScopes = parseRequestedScopes(queryParams);
  const requestedScopeSet = new Set(requestedScopes);
  for (const scope of scopes) {
    if (!requestedScopeSet.has(scope)) {
      return NextResponse.json(
        { error: `Scope not requested: ${scope}` },
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
    clientId,
    scopes,
  });

  return NextResponse.json({
    intent_token: intent.intentToken,
    expires_at: intent.expiresAt,
  });
}
