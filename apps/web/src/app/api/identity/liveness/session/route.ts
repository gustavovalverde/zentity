import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCachedSession } from "@/lib/auth/session";
import { getIdentityDraftById } from "@/lib/db/queries/identity";
import { createRateLimiter, rateLimitResponse } from "@/lib/http/rate-limit";
import { jsonError } from "@/lib/http/route-responses";
import { createLivenessSession } from "@/lib/identity/liveness/session";

const bodySchema = z.object({
  challengeCount: z.number().int().min(1).max(3).optional(),
  draftId: z.string().min(1).optional(),
});

// Per-user quota on session creation. The per-session frame throttle cannot stop
// a user from minting many sessions to run the CPU-heavy detector flat out.
const sessionLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

export async function POST(request: Request): Promise<Response> {
  const auth = await getCachedSession(await headers());
  if (!auth?.user) {
    return jsonError("Unauthorized", 401);
  }
  const userId = auth.user.id;

  if (sessionLimiter.check(userId).limited) {
    return rateLimitResponse();
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body is allowed; defaults apply.
  }
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return jsonError("Invalid request", 400);
  }

  // Validate draft ownership server-side; the userId comes from the session,
  // never from the body.
  let draftId: string | null = null;
  if (parsed.data.draftId) {
    const draft = await getIdentityDraftById(parsed.data.draftId);
    if (!draft || draft.userId !== userId) {
      return jsonError("Draft not found", 404);
    }
    draftId = parsed.data.draftId;
  }

  const created = createLivenessSession({
    userId,
    draftId,
    challengeCount: parsed.data.challengeCount,
  });

  return NextResponse.json({
    sessionId: created.sessionId,
    expiresAt: created.expiresAt,
    phase: created.snapshot.phase,
    currentChallenge: created.snapshot.challenge,
  });
}
