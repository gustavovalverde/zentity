import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { isWarmupComplete } from "@/lib/observability/warmup-state";

const DB_TIMEOUT_MS = 2000;

function checkDb(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), DB_TIMEOUT_MS);
    db.run(sql`SELECT 1`)
      .then(() => resolve(true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer));
  });
}

export async function GET() {
  const warmup = isWarmupComplete();
  const dbOk = await checkDb();
  const ready = warmup && dbOk;

  return NextResponse.json(
    {
      ready,
      checks: {
        warmup: warmup ? "complete" : "in_progress",
        db: dbOk ? "ok" : "unreachable",
      },
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    }
  );
}
