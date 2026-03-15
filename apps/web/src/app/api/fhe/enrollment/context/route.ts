import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import { createFheEnrollmentContext } from "@/lib/auth/fhe-enrollment-tokens";
import { rateLimitResponse } from "@/lib/utils/rate-limit";
import { fheLimiter } from "@/lib/utils/rate-limiters";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authResult = await requireSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = fheLimiter.check(authResult.session.user.id);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
  } | null;

  const email =
    body && typeof body.email === "string" && body.email.trim()
      ? body.email.trim()
      : null;

  const { contextToken, registrationToken, expiresAt } =
    await createFheEnrollmentContext({
      userId: authResult.session.user.id,
      email,
    });

  return NextResponse.json(
    { contextToken, registrationToken, expiresAt },
    { status: 201 }
  );
}
