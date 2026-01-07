import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import { createOnboardingContext } from "@/lib/auth/onboarding-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authResult = await requireSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
  } | null;

  const email =
    body && typeof body.email === "string" && body.email.trim()
      ? body.email.trim()
      : null;

  const { contextToken, registrationToken, expiresAt } =
    await createOnboardingContext({
      userId: authResult.session.user.id,
      email,
    });

  return NextResponse.json(
    { contextToken, registrationToken, expiresAt },
    { status: 201 }
  );
}
