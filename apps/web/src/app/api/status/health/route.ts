import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";

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
  const dbOk = await checkDb();
  const status = dbOk ? "healthy" : "degraded";

  return NextResponse.json(
    { status, checks: { db: dbOk ? "ok" : "unreachable" } },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    }
  );
}
