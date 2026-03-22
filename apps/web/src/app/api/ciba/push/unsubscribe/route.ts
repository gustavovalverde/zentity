import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import { db } from "@/lib/db/connection";
import { pushSubscriptions } from "@/lib/db/schema/push";
import { rateLimitResponse } from "@/lib/utils/rate-limit";
import { cibaLimiter } from "@/lib/utils/rate-limiters";

export const runtime = "nodejs";

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(request: Request) {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = cibaLimiter.check(authResult.session.user.id);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const body = await request.json().catch(() => null);
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        eq(pushSubscriptions.userId, authResult.session.user.id)
      )
    );

  return NextResponse.json({ ok: true });
}
