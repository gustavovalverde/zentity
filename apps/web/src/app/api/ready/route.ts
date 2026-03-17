import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { isWarmupComplete } from "@/lib/observability/warmup-state";

export async function GET() {
  const warmup = isWarmupComplete();

  let dbReachable = false;
  try {
    await db.run(sql`SELECT 1`);
    dbReachable = true;
  } catch {
    // DB check failed
  }

  const ready = warmup && dbReachable;

  return NextResponse.json(
    {
      ready,
      checks: {
        warmup: warmup ? "complete" : "in_progress",
        db: dbReachable ? "ok" : "unreachable",
      },
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    }
  );
}
