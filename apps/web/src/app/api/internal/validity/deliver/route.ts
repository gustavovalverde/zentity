import { NextResponse } from "next/server";
import { z } from "zod";

import { validityDeliveryTargetEnum } from "@/lib/db/schema/identity";
import { requireAdminApiKey } from "@/lib/http/admin-auth";
import { deliverPendingValidityDeliveries } from "@/lib/identity/validity/delivery";

const bodySchema = z.object({
  eventId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
  targets: z.array(z.enum(validityDeliveryTargetEnum)).min(1).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const parsedBody = bodySchema.safeParse(
    (await request.json().catch(() => ({}))) as unknown
  );
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid delivery payload",
        issues: z.flattenError(parsedBody.error),
      },
      { status: 400 }
    );
  }

  const { eventId, limit, targets } = parsedBody.data;
  const result = await deliverPendingValidityDeliveries({
    ...(eventId ? { eventId } : {}),
    ...(limit ? { limit } : {}),
    ...(targets ? { targets } : {}),
  });
  return NextResponse.json(result);
}
