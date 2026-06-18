import { NextResponse } from "next/server";
import { z } from "zod";

import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { handleIdentityIntent } from "@/lib/auth/oidc/disclosure/route-handlers";
import {
  fetchCibaAuthReqIdHashById,
  validatePendingCibaRequest,
} from "@/lib/db/queries/ciba";

const IntentSchema = z
  .object({
    auth_req_id: z.string().min(1).optional(),
    request_id: z.string().min(1).optional(),
    scopes: z.array(z.string()).min(1),
  })
  .refine((b) => Boolean(b.auth_req_id) !== Boolean(b.request_id), {
    message: "Provide exactly one of auth_req_id or request_id",
  });

export function POST(request: Request): Promise<Response> {
  return handleIdentityIntent(request, async (body, userId) => {
    const parsed = IntentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { auth_req_id, request_id, scopes } = parsed.data;
    // A dashboard listing owns the request by id but never holds the raw token;
    // both paths resolve to the stored hash that keys CIBA lookups.
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
      authReqId: authReqIdHash,
    };
  });
}
