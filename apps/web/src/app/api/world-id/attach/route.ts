import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/env";
import { requireBrowserSession } from "@/lib/auth/resource-auth";
import {
  attachHumanSignal,
  consumeHumanSignalChallenge,
  HumanSignalAlreadyAttachedError,
} from "@/lib/db/queries/identity";
import { humanSignalLimiter, rateLimitResponse } from "@/lib/http/rate-limit";
import {
  computeHumanSignalSubjectHash,
  requireHumanSignalHmacSecret,
} from "@/lib/identity/human-signal";
import {
  verifyWorldIdProof,
  WorldIdConfigurationError,
  WorldIdVerificationError,
  worldIdProofSchema,
  worldIdUnavailableResponse,
} from "@/lib/identity/world-id";

export const runtime = "nodejs";

const attachSchema = z.object({
  challengeId: z.string().min(1),
  idkitResult: worldIdProofSchema,
});

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

  const body = await request.json().catch(() => null);
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_world_id_result" },
      { status: 400 }
    );
  }

  const challenge = await consumeHumanSignalChallenge({
    id: parsed.data.challengeId,
    userId,
    provider: "world_id",
    nonce: parsed.data.idkitResult.nonce,
  });
  if (!challenge) {
    return NextResponse.json(
      { error: "invalid_world_id_challenge" },
      { status: 400 }
    );
  }

  try {
    const verified = await verifyWorldIdProof({
      expectedSignal: userId,
      proof: parsed.data.idkitResult,
    });
    const providerSubjectHash = computeHumanSignalSubjectHash({
      secret: requireHumanSignalHmacSecret(env.HUMAN_SIGNAL_HMAC_SECRET),
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubject: verified.nullifier,
    });

    const signal = await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash,
    });

    return NextResponse.json(
      {
        ok: true,
        signal: {
          provider: signal.provider,
          attachedAt: signal.attachedAt,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof WorldIdConfigurationError) {
      return worldIdUnavailableResponse();
    }
    if (error instanceof WorldIdVerificationError) {
      return NextResponse.json(
        { error: "world_id_verification_failed" },
        { status: error.status }
      );
    }
    if (error instanceof HumanSignalAlreadyAttachedError) {
      return NextResponse.json(
        { error: "human_signal_already_attached" },
        { status: 409 }
      );
    }
    throw error;
  }
}
