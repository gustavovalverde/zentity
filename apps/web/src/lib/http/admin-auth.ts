import "server-only";

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/env";

const ADMIN_KEY_HEADER = "x-zentity-admin-key";

function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAdminApiKey(request: Request): Response | null {
  const expectedKey = env.ZENTITY_ADMIN_API_KEY;
  const providedKey = request.headers.get(ADMIN_KEY_HEADER);
  if (!(expectedKey && providedKey && keysMatch(providedKey, expectedKey))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
