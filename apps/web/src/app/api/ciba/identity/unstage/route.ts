import { NextResponse } from "next/server";
import { z } from "zod";

import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { clearReleaseContext } from "@/lib/auth/oidc/disclosure/context";
import { handleIdentityUnstage } from "@/lib/auth/oidc/disclosure/route-handlers";
import {
  fetchCibaAuthReqIdHashById,
  validateCibaRequestOwnership,
} from "@/lib/db/queries/ciba";

const UnstageSchema = z
  .object({
    auth_req_id: z.string().min(1).optional(),
    request_id: z.string().min(1).optional(),
  })
  .refine((b) => Boolean(b.auth_req_id) !== Boolean(b.request_id), {
    message: "Provide exactly one of auth_req_id or request_id",
  });

export function POST(request: Request): Promise<Response> {
  return handleIdentityUnstage(
    request,
    async (body, userId) => {
      const parsed = UnstageSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const { auth_req_id, request_id } = parsed.data;
      // A dashboard listing owns the request by id but never holds the raw
      // token; both paths resolve to the stored hash that keys CIBA lookups.
      const authReqIdHash = request_id
        ? await fetchCibaAuthReqIdHashById(request_id)
        : hashCibaAuthReqId(auth_req_id as string);
      if (!authReqIdHash) {
        return NextResponse.json({ error: "Unknown request" }, { status: 404 });
      }

      const result = await validateCibaRequestOwnership(authReqIdHash, userId);
      if (result instanceof Response) {
        return result;
      }

      return { releaseId: authReqIdHash };
    },
    async (result) => {
      await clearReleaseContext((result as { releaseId: string }).releaseId);
    }
  );
}
