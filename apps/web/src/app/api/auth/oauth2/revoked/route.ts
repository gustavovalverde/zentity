/**
 * Revocation delta-stream endpoint (Proposal-0003 D-6).
 *
 * `GET /api/auth/oauth2/revoked?since=<unix-ms>` returns every revoked `jti`
 * recorded strictly after `since`, ordered oldest-first. The wallet runtime
 * polls this on a hard-capped interval; each poll advances `since` to the
 * `next` cursor in the response so revocations propagate without ever
 * resending the full set.
 *
 * The endpoint is operator-readable, not public-internet-readable: the wallet
 * runtime presents `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. When that
 * env var is unset (local dev) the endpoint is open so the probe can poll
 * without a secret; once it is configured the Bearer is required and a
 * mismatch returns 401. The compare is constant-time.
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/env";
import { listRevocationsSince } from "@/lib/auth/oidc/token-revocation";

const QuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(1000).default(500),
});

function isAuthorized(request: Request): boolean {
  const expected = env.INTERNAL_SERVICE_TOKEN;
  if (!expected) {
    return true;
  }
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length === 0) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "bearer token required" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    since: url.searchParams.get("since") ?? "0",
    limit: url.searchParams.get("limit") ?? "500",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description:
          "since (unix ms, default 0) and limit (1..1000, default 500) are integer query params",
      },
      { status: 400 }
    );
  }

  const rows = await listRevocationsSince({
    sinceUnixMs: parsed.data.since,
    limit: parsed.data.limit,
  });

  // Advance the cursor to the newest revoked_at the caller has now seen. The
  // query orders by (revoked_at, jti) but the cursor is millisecond-only, so a
  // full (truncated) page whose boundary falls between two same-millisecond
  // revocations would skip the rows after the cut — a fail-open hole. When the
  // page is truncated, rewind the cursor by 1ms so the next poll re-fetches the
  // boundary millisecond; the wallet's revocation set is monotonic and dedupes
  // the re-sent rows. An empty result keeps the cursor at `since`.
  const lastRow = rows.at(-1);
  const truncated = rows.length === parsed.data.limit;
  const nextSince = lastRow
    ? lastRow.revokedAt.getTime() - (truncated ? 1 : 0)
    : parsed.data.since;

  return NextResponse.json({
    since: parsed.data.since,
    next_since: nextSince,
    revocations: rows.map((row) => ({
      jti: row.jti,
      revoked_at: row.revokedAt.toISOString(),
      reason: row.reason,
    })),
    truncated: rows.length === parsed.data.limit,
  });
}
