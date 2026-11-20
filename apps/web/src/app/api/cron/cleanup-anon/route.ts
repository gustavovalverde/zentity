import { constantTimeEqual } from "better-auth/crypto";

import { env } from "@/env";
import { deleteExpiredPairwiseProofOnlyConsents } from "@/lib/auth/oidc/disclosure/consent-cleanup";
import { deleteExpiredAnonymousUsers } from "@/lib/db/queries/auth";
import { logError } from "@/lib/logging/error-logger";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANON_TTL_MS = 24 * 60 * 60 * 1000;

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) {
    return false;
  }
  const header = req.headers.get("authorization");
  if (!header) {
    return false;
  }
  const match = BEARER_PATTERN.exec(header);
  const presented = match?.[1];
  return !!presented && constantTimeEqual(presented, env.CRON_SECRET);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const deleted = await deleteExpiredAnonymousUsers(ANON_TTL_MS);
    const deletedPairwiseConsents =
      await deleteExpiredPairwiseProofOnlyConsents();
    logger.info(
      { deleted, ttlHours: ANON_TTL_MS / 3_600_000 },
      "anon-user cleanup"
    );
    return Response.json({ deleted, deletedPairwiseConsents });
  } catch (error) {
    logError(error, { path: "cron.cleanup-anon" });
    return new Response("Internal Error", { status: 500 });
  }
}
