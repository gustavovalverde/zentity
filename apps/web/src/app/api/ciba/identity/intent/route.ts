import { NextResponse } from "next/server";
import { z } from "zod";

import { handleIdentityIntent } from "@/lib/auth/oidc/identity-delivery";
import { validatePendingCibaRequest } from "@/lib/db/queries/ciba";

const IntentSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityIntent(request, async (body, userId) => {
    const parsed = IntentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { auth_req_id, scopes } = parsed.data;

    const result = await validatePendingCibaRequest(auth_req_id, userId);
    if (result instanceof Response) {
      return result;
    }

    return {
      clientId: result.clientId,
      authorizedScopes: result.scope.split(" "),
      scopes,
      authReqId: auth_req_id,
    };
  });
}
