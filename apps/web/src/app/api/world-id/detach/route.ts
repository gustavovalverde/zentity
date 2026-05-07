import { NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/auth/resource-auth";
import { detachHumanSignal } from "@/lib/db/queries/identity";
import { humanSignalLimiter, rateLimitResponse } from "@/lib/http/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const userId = authResult.session.user.id;
  const { limited, retryAfter } = humanSignalLimiter.check(userId);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const detachedCount = await detachHumanSignal({
    userId,
    provider: "world_id",
  });

  return NextResponse.json(
    { ok: true, detached: detachedCount > 0 },
    { headers: { "Cache-Control": "no-store" } }
  );
}
