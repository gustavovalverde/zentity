import { timingSafeEqual } from "node:crypto";

import { env } from "@/env";
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
  if (!presented) {
    return false;
  }
  const expected = Buffer.from(env.CRON_SECRET);
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const deleted = await deleteExpiredAnonymousUsers(ANON_TTL_MS);
    logger.info(
      { deleted, ttlHours: ANON_TTL_MS / 3_600_000 },
      "anon-user cleanup"
    );
    return Response.json({ deleted });
  } catch (error) {
    logError(error, { path: "cron.cleanup-anon" });
    return new Response("Internal Error", { status: 500 });
  }
}
