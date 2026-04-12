import { NextResponse } from "next/server";
import { z } from "zod";

import { handleIdentityIntent } from "@/lib/auth/oidc/identity-delivery";
import {
  parseRequestedScopes,
  verifySignedOAuthQuery,
} from "@/lib/auth/oidc/oauth-query";

const IntentSchema = z.object({
  oauth_query: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityIntent(request, async (body) => {
    const parsed = IntentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    let queryParams: URLSearchParams;
    try {
      queryParams = await verifySignedOAuthQuery(parsed.data.oauth_query);
    } catch {
      return NextResponse.json(
        { error: "Invalid OAuth query" },
        { status: 400 }
      );
    }

    const clientId = queryParams.get("client_id");
    if (!clientId) {
      return NextResponse.json({ error: "Missing client_id" }, { status: 400 });
    }

    return {
      clientId,
      authorizedScopes: parseRequestedScopes(queryParams),
      scopes: parsed.data.scopes,
    };
  });
}
