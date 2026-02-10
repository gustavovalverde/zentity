import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { clearEphemeralClaims } from "@/lib/auth/oidc/ephemeral-identity-claims";
import { verifySignedOAuthQuery } from "@/lib/auth/oidc/oauth-query";

const UnstageSchema = z.object({
  oauth_query: z.string().min(1),
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

  const parsed = UnstageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let queryParams: URLSearchParams;
  try {
    queryParams = await verifySignedOAuthQuery(parsed.data.oauth_query);
  } catch {
    return NextResponse.json({ error: "Invalid OAuth query" }, { status: 400 });
  }

  const clientId = queryParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "Missing client_id" }, { status: 400 });
  }

  clearEphemeralClaims(session.user.id, clientId);
  return NextResponse.json({ cleared: true });
}
