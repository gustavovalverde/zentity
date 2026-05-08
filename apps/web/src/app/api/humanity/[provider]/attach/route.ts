import { NextResponse } from "next/server";
import { z } from "zod";

import { requireBrowserSession } from "@/lib/auth/resource-auth";
import {
  attachHumanityCredential,
  consumeHumanityChallenge,
  HumanityCredentialAlreadyAttachedError,
} from "@/lib/db/queries/humanity";
import {
  humanityCredentialLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import {
  HumanityProofVerificationError,
  HumanityProviderConfigurationError,
  HumanityProviderNotFoundError,
} from "@/lib/identity/humanity/errors";
import { verifyProof } from "@/lib/identity/humanity/verify";
import { rematerializeAllUserVerifications } from "@/lib/identity/verification/materialize";

export const runtime = "nodejs";

const attachSchema = z.object({
  challengeId: z.string().min(1),
  proof: z.unknown(),
  /** Echoed back from the challenge response — used to bind to the DB row. */
  nonce: z.string().min(1),
});

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

  const body = await request.json().catch(() => null);
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const challenge = await consumeHumanityChallenge({
    id: parsed.data.challengeId,
    userId,
    provider,
    nonce: parsed.data.nonce,
  });
  if (!challenge) {
    return NextResponse.json(
      { error: "invalid_humanity_challenge" },
      { status: 400 }
    );
  }

  try {
    const verified = await verifyProof({
      providerId: provider,
      request: {
        expectedNonce: challenge.nonce,
        expectedSignal: userId,
        proof: parsed.data.proof,
      },
    });

    const credential = await attachHumanityCredential({
      userId,
      provider: verified.envelope.provider,
      providerSubjectKind: verified.envelope.providerSubjectKind,
      providerSubjectHash: verified.envelope.providerSubjectHash,
      providerMetadata: verified.envelope.providerMetadata,
      expiresAt: verified.envelope.expiresAt,
    });

    await rematerializeAllUserVerifications(userId);

    return NextResponse.json(
      {
        ok: true,
        credential: {
          provider: credential.provider,
          attachedAt: credential.attachedAt,
        },
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
    if (error instanceof HumanityProofVerificationError) {
      return NextResponse.json(
        { error: "humanity_verification_failed" },
        { status: error.status }
      );
    }
    if (error instanceof HumanityCredentialAlreadyAttachedError) {
      return NextResponse.json(
        { error: "humanity_credential_already_attached" },
        { status: 409 }
      );
    }
    throw error;
  }
}
