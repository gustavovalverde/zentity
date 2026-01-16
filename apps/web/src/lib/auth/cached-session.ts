/**
 * Cached Session Utility
 *
 * Uses React.cache() to deduplicate getSession() calls within a single request.
 * This prevents the waterfall of session fetches across layout hierarchy:
 * - Dashboard layout fetches session
 * - Dashboard page fetches session again
 * - Child pages fetch session again
 *
 * With cache(), all these calls resolve to a single database/auth lookup.
 *
 * SECURITY NOTE: React.cache() is per-request memoization only - NOT a persistent
 * cache. Each HTTP request gets an isolated cache scope that's discarded when the
 * request completes. This is safe for shared computers because:
 * - When user A logs out and user B logs in, B makes a new request with fresh cache
 * - Session validation (via auth.api.getSession) always runs at least once per request
 * - The session cookie is validated independently for each request
 */
import "server-only";

import type { headers } from "next/headers";

import { cache } from "react";

import { auth } from "@/lib/auth/auth";

type HeadersObject = Awaited<ReturnType<typeof headers>>;

/**
 * Get the current session with per-request deduplication.
 * Replace all `auth.api.getSession({ headers })` calls with this.
 */
export const getCachedSession = cache(async (headersObj: HeadersObject) => {
  return await auth.api.getSession({ headers: headersObj });
});
