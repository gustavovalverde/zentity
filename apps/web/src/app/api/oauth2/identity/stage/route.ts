import { NextResponse } from "next/server";
import { z } from "zod";

import { storeEphemeralClaims } from "@/lib/auth/oidc/ephemeral-identity-claims";
import { IdentityFieldsSchema } from "@/lib/auth/oidc/identity-fields-schema";
import { handleIdentityStage } from "@/lib/auth/oidc/identity-handler";
import {
  parseRequestedScopes,
  verifySignedOAuthQuery,
} from "@/lib/auth/oidc/oauth-query";

const StageSchema = z.object({
  oauth_query: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  identity: IdentityFieldsSchema.optional(),
  intent_token: z.string().min(1).optional(),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityStage(
    request,
    async (body) => {
      const parsed = StageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { oauth_query, scopes, identity, intent_token } = parsed.data;

      let queryParams: URLSearchParams;
      try {
        queryParams = await verifySignedOAuthQuery(oauth_query);
      } catch {
        return NextResponse.json(
          { error: "Invalid OAuth query" },
          { status: 400 }
        );
      }

      const clientId = queryParams.get("client_id");
      if (!clientId) {
        return NextResponse.json(
          { error: "Missing client_id" },
          { status: 400 }
        );
      }

      return {
        clientId,
        authorizedScopes: parseRequestedScopes(queryParams),
        scopes,
        identity,
        intentToken: intent_token,
      };
    },
    async ({
      userId,
      filteredIdentity,
      scopes,
      clientId,
      scopeHash,
      intentJti,
    }) => {
      const stored = await storeEphemeralClaims(
        userId,
        filteredIdentity,
        scopes,
        { clientId, scopeHash, intentJti },
        "oauth"
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
  );
}
