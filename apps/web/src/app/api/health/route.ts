import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";

export async function GET() {
  let dbStatus: "ok" | "unreachable" = "unreachable";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await db.run(sql`SELECT 1`);
    clearTimeout(timeout);
    dbStatus = "ok";
  } catch {
    // DB unreachable — report degraded, don't crash
  }

  const status = dbStatus === "ok" ? "healthy" : "degraded";

  return NextResponse.json(
    { status, checks: { db: dbStatus } },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    }
  );
}
