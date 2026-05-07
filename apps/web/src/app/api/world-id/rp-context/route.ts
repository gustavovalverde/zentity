import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/auth/resource-auth";
import { createHumanSignalChallenge } from "@/lib/db/queries/identity";
import { humanSignalLimiter, rateLimitResponse } from "@/lib/http/rate-limit";
import {
  buildWorldIdRequest,
  WorldIdConfigurationError,
  worldIdUnavailableResponse,
} from "@/lib/identity/world-id";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = humanSignalLimiter.check(
    authResult.session.user.id
  );
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  try {
    const config = buildWorldIdRequest();
    const challengeId = crypto.randomUUID();
    await createHumanSignalChallenge({
      id: challengeId,
      userId: authResult.session.user.id,
      provider: "world_id",
      nonce: config.rpContext.nonce,
      expiresAt: new Date(config.rpContext.expires_at * 1000).toISOString(),
    });

    return NextResponse.json(
      {
        action: config.action,
        appId: config.appId,
        challengeId,
        environment: config.environment,
        rpContext: config.rpContext,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof WorldIdConfigurationError) {
      return worldIdUnavailableResponse();
    }
    throw error;
  }
}
