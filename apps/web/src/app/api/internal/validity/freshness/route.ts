import { NextResponse } from "next/server";

import { requireAdminApiKey } from "@/lib/http/admin-auth";
import { markDueIdentitiesStale } from "@/lib/identity/validity/freshness-worker";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const result = await markDueIdentitiesStale();
  return NextResponse.json(result);
}
