import { NextResponse } from "next/server";
import { z } from "zod";

import { handleIdentityUnstage } from "@/lib/auth/oidc/identity-handler";
import { validateCibaRequestOwnership } from "@/lib/db/queries/ciba";

const UnstageSchema = z.object({
  auth_req_id: z.string().min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityUnstage(request, async (body, userId) => {
    const parsed = UnstageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const result = await validateCibaRequestOwnership(
      parsed.data.auth_req_id,
      userId
    );
    if (result instanceof Response) {
      return result;
    }

    return result.clientId;
  });
}
