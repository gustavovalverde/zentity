import { NextResponse } from "next/server";

import { env } from "@/env";
import { markDueIdentitiesStale } from "@/lib/identity/validity/freshness-worker";

function isAuthorized(request: Request): boolean {
  const expectedKey = env.ZENTITY_ADMIN_API_KEY;
  if (!expectedKey) {
    return false;
  }

  return request.headers.get("x-zentity-admin-key") === expectedKey;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await markDueIdentitiesStale();
  return NextResponse.json(result);
}
