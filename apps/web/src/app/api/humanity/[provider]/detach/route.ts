import { NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/auth/resource-auth";
import { detachHumanityCredential } from "@/lib/db/queries/humanity";
import {
  humanityCredentialLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import { rematerializeAllUserVerifications } from "@/lib/identity/verification/materialize";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
): Promise<Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const userId = authResult.session.user.id;
  const { limited, retryAfter } = humanityCredentialLimiter.check(userId);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const { provider } = await context.params;

  const detachedCount = await detachHumanityCredential({
    userId,
    provider,
  });
  if (detachedCount > 0) {
    await rematerializeAllUserVerifications(userId);
  }

  return NextResponse.json(
    { ok: true, detached: detachedCount > 0 },
    { headers: { "Cache-Control": "no-store" } }
  );
}
