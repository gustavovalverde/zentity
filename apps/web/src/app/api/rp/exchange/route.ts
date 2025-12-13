import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeRpAuthorizationCode,
  getIdentityProofByUserId,
  getUserAgeProof,
  getVerificationStatus,
} from "@/lib/db";

/**
 * RP code exchange endpoint (server-to-server)
 *
 * Accepts a short-lived, single-use authorization `code` issued by `/api/rp/complete`
 * and returns minimal verification flags for the associated user.
 *
 * Security goals:
 * - One-time use + expiry enforced in DB (replay resistance)
 * - Optional `client_id` mismatch check (lightweight sanity check)
 *
 * Privacy goals:
 * - Return only coarse flags (verified/checks), not PII, photos, embeddings, or raw proofs.
 *
 * NOTE: This is an MVP for closed-beta integrations. A production-grade version
 * should add client authentication (secret/PKCE), strict redirect_uri binding,
 * rate limiting, and optionally a signed JWT assertion.
 */
const bodySchema = z.object({
  code: z.uuid(),
  client_id: z.uuid().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const consumed = consumeRpAuthorizationCode(parsed.data.code);
  if (!consumed) {
    return NextResponse.json(
      { error: "Invalid or expired code" },
      { status: 400 },
    );
  }

  if (parsed.data.client_id && parsed.data.client_id !== consumed.clientId) {
    return NextResponse.json({ error: "client_id mismatch" }, { status: 400 });
  }

  const userId = consumed.userId;
  const ageProof = getUserAgeProof(userId);
  const identityProof = getIdentityProofByUserId(userId);
  const verificationStatus = getVerificationStatus(userId);

  const checks = {
    document: identityProof?.isDocumentVerified ?? false,
    liveness: identityProof?.isLivenessPassed ?? false,
    faceMatch: identityProof?.isFaceMatched ?? false,
    ageProof: Boolean(ageProof?.isOver18),
  };

  const verified = Boolean(verificationStatus?.verified || ageProof?.isOver18);

  return NextResponse.json({
    success: true,
    verified,
    level: verificationStatus?.level ?? (verified ? "basic" : "none"),
    checks,
  });
}
