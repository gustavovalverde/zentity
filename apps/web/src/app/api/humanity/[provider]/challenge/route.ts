import { NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/auth/resource-auth";
import {
  humanityCredentialLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import { issueHumanityChallenge } from "@/lib/identity/humanity/challenge";
import {
  HumanityProviderConfigurationError,
  HumanityProviderNotFoundError,
} from "@/lib/identity/humanity/errors";

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

  try {
    const issued = await issueHumanityChallenge({
      providerId: provider,
      userId,
    });
    return NextResponse.json(
      {
        challengeId: issued.challengeId,
        provider,
        nonce: issued.nonce,
        expiresAt: issued.expiresAt,
        payload: issued.payload,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof HumanityProviderNotFoundError) {
      return NextResponse.json(
        { error: "humanity_provider_not_found" },
        { status: 404 }
      );
    }
    if (error instanceof HumanityProviderConfigurationError) {
      return NextResponse.json(
        { error: "humanity_provider_unavailable" },
        { status: 503 }
      );
    }
    throw error;
  }
}
