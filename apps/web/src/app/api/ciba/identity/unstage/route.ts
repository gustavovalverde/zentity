import { NextResponse } from "next/server";
import { z } from "zod";

import { clearReleaseContext } from "@/lib/auth/oidc/disclosure/context";
import { handleIdentityUnstage } from "@/lib/auth/oidc/disclosure/delivery";
import { validateCibaRequestOwnership } from "@/lib/db/queries/ciba";

const UnstageSchema = z.object({
  auth_req_id: z.string().min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityUnstage(
    request,
    async (body, userId) => {
      const parsed = UnstageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const { auth_req_id } = parsed.data;

      const result = await validateCibaRequestOwnership(auth_req_id, userId);
      if (result instanceof Response) {
        return result;
      }

      return { releaseId: auth_req_id };
    },
    async (result) => {
      await clearReleaseContext((result as { releaseId: string }).releaseId);
    }
  );
}
