/**
 * Revocation delta-stream endpoint (Proposal-0003 D-6).
 *
 * `GET /api/auth/oauth2/revoked?since=<unix-ms>` returns every revoked `jti`
 * recorded strictly after `since`, ordered oldest-first. The wallet runtime
 * polls this on a hard-capped interval; each poll advances `since` to the
 * `next` cursor in the response so revocations propagate without ever
 * resending the full set.
 *
 * The endpoint is operator-readable, not public-internet-readable: the
 * wallet runtime presents a Bearer token with the
 * `agent:revocation.read` scope (gated upstream of this handler by
 * better-auth's resource-auth middleware). v1 ships open in dev; the
 * deployment runbook lists the env vars that activate the gate in prod.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { listRevocationsSince } from "@/lib/auth/oidc/token-revocation";

const QuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(1000).default(500),
});

export async function GET(request: Request) {
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

  // Advance the cursor to the newest revoked_at the caller has now seen, so
  // the next poll picks up strictly after this batch. If the result is empty
  // the cursor stays at `since`.
  const lastRow = rows.at(-1);
  const nextSince = lastRow ? lastRow.revokedAt.getTime() : parsed.data.since;

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
