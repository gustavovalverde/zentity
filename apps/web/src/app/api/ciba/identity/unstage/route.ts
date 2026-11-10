import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearReleaseContext,
  releaseIdFor,
} from "@/lib/auth/oidc/disclosure/context";
import { handleIdentityUnstage } from "@/lib/auth/oidc/disclosure/route-handlers";
import {
  fetchCibaAuthReqIdHashById,
  validateCibaRequestOwnership,
} from "@/lib/db/queries/ciba";

const UnstageSchema = z.object({
  request_id: z.string().min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityUnstage(
    request,
    async (body, userId) => {
      const parsed = UnstageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const { request_id } = parsed.data;
      // CIBA-scoped stores are keyed by the stored auth_req_id hash.
      const authReqIdHash = await fetchCibaAuthReqIdHashById(request_id);
      if (!authReqIdHash) {
        return NextResponse.json({ error: "Unknown request" }, { status: 404 });
      }

      const result = await validateCibaRequestOwnership(authReqIdHash, userId);
      if (result instanceof Response) {
        return result;
      }

      return { releaseId: releaseIdFor(authReqIdHash, result.clientId) };
    },
    async (result) => {
      await clearReleaseContext((result as { releaseId: string }).releaseId);
    }
  );
}
