import "server-only";

import { constantTimeEqual } from "better-auth/crypto";
import { NextResponse } from "next/server";

import { env } from "@/env";

const ADMIN_KEY_HEADER = "x-zentity-admin-key";

export function requireAdminApiKey(request: Request): Response | null {
  const expectedKey = env.ZENTITY_ADMIN_API_KEY;
  const providedKey = request.headers.get(ADMIN_KEY_HEADER);
  if (
    !(expectedKey && providedKey && constantTimeEqual(providedKey, expectedKey))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
