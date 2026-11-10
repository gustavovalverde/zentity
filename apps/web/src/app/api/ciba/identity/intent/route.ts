import { NextResponse } from "next/server";
import { z } from "zod";

import { handleIdentityIntent } from "@/lib/auth/oidc/disclosure/route-handlers";
import {
  fetchCibaAuthReqIdHashById,
  validatePendingCibaRequest,
} from "@/lib/db/queries/ciba";

const IntentSchema = z.object({
  request_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
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

    const { request_id, scopes } = parsed.data;
    // CIBA-scoped stores are keyed by the stored auth_req_id hash.
    const authReqIdHash = await fetchCibaAuthReqIdHashById(request_id);
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
