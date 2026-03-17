import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CIBA_EPHEMERAL_TTL_MS,
  storeEphemeralClaims,
} from "@/lib/auth/oidc/ephemeral-identity-claims";
import { IdentityFieldsSchema } from "@/lib/auth/oidc/identity-fields-schema";
import { handleIdentityStage } from "@/lib/auth/oidc/identity-handler";
import { validatePendingCibaRequest } from "@/lib/db/queries/ciba";

const StageSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  identity: IdentityFieldsSchema.optional(),
  intent_token: z.string().min(1),
});

/**
 * POST /api/ciba/identity/stage — Store ephemeral PII for a CIBA request.
 *
 * Stores identity claims in the ephemeral in-memory store with a 10-minute
 * TTL. The RP retrieves PII by calling the standard userinfo endpoint with
 * the CIBA access token.
 */
export function POST(request: Request): Promise<Response> {
  return handleIdentityStage(
    request,
    async (body, userId) => {
      const parsed = StageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { auth_req_id, scopes, identity, intent_token } = parsed.data;

      const result = await validatePendingCibaRequest(auth_req_id, userId);
      if (result instanceof Response) {
        return result;
      }

      return {
        clientId: result.clientId,
        authorizedScopes: result.scope.split(" "),
        scopes,
        identity,
        intentToken: intent_token,
        authReqId: auth_req_id,
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
        CIBA_EPHEMERAL_TTL_MS
      );

      if (!stored.ok) {
        return NextResponse.json(
          { error: "Identity intent token has already been used" },
          { status: 409 }
        );
      }

      return NextResponse.json({ staged: true });
    }
  );
}
