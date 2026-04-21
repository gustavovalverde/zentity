import "server-only";

import { NextResponse } from "next/server";

import { env } from "@/env";

const ADMIN_KEY_HEADER = "x-zentity-admin-key";

export function requireAdminApiKey(request: Request): Response | null {
  const expectedKey = env.ZENTITY_ADMIN_API_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get(ADMIN_KEY_HEADER) !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
