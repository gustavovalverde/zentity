import { NextResponse } from "next/server";
import { z } from "zod";

import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { stageFinalCibaDisclosure } from "@/lib/auth/oidc/disclosure/context";
import { IdentityFieldsSchema } from "@/lib/auth/oidc/disclosure/delivery";
import { handleIdentityStage } from "@/lib/auth/oidc/disclosure/route-handlers";
import {
  fetchCibaAuthReqIdHashById,
  validatePendingCibaRequest,
} from "@/lib/db/queries/ciba";

const StageSchema = z
  .object({
    auth_req_id: z.string().min(1).optional(),
    request_id: z.string().min(1).optional(),
    scopes: z.array(z.string()).min(1),
    identity: IdentityFieldsSchema.optional(),
    intent_token: z.string().min(1),
  })
  .refine((b) => Boolean(b.auth_req_id) !== Boolean(b.request_id), {
    message: "Provide exactly one of auth_req_id or request_id",
  });

/**
 * POST /api/ciba/identity/stage — Bind a CIBA release context and stage PII.
 *
 * Persists the final non-PII release metadata durably by `auth_req_id` and
 * stores the plaintext identity payload in the volatile in-memory store with
 * a 10-minute TTL. The RP retrieves PII by calling the standard userinfo
 * endpoint with the bound CIBA access token.
 */
export function POST(request: Request): Promise<Response> {
  return handleIdentityStage(
    request,
    async (body, userId) => {
      const parsed = StageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid request", details: z.flattenError(parsed.error) },
          { status: 400 }
        );
      }

      const { auth_req_id, request_id, scopes, identity, intent_token } =
        parsed.data;
      // A dashboard listing owns the request by id but never holds the raw
      // token; both paths resolve to the stored hash that keys CIBA lookups.
      const authReqIdHash = request_id
        ? await fetchCibaAuthReqIdHashById(request_id)
        : hashCibaAuthReqId(auth_req_id as string);
      if (!authReqIdHash) {
        return NextResponse.json({ error: "Unknown request" }, { status: 404 });
      }

      const result = await validatePendingCibaRequest(authReqIdHash, userId);
      if (result instanceof Response) {
        return result;
      }

      return {
        clientId: result.clientId,
        authorizedScopes: result.scope.split(" "),
        scopes,
        identity,
        intentToken: intent_token,
        authReqId: authReqIdHash,
      };
    },
    async ({
      userId,
      filteredIdentity,
      identityScopes,
      clientId,
      scopeHash,
      intentJti,
      authReqId,
    }) => {
      if (!authReqId) {
        return NextResponse.json(
          { error: "Missing auth_req_id disclosure binding" },
          { status: 400 }
        );
      }

      const stored = await stageFinalCibaDisclosure({
        userId,
        clientId,
        claims: filteredIdentity,
        releaseId: authReqId,
        scopes: identityScopes,
        scopeHash,
        intentJti,
      });

      if (!stored.ok) {
        if (stored.reason === "intent_reused") {
          return NextResponse.json(
            { error: "Identity intent token has already been used" },
            { status: 409 }
          );
        }
        return NextResponse.json(
          {
            error:
              "An identity stage already exists for this client. Wait for the pending request to complete or expire.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ staged: true });
    }
  );
}
