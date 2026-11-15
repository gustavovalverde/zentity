import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getClientIp,
  publicLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
/**
 * Breached password range proxy (UX-only).
 *
 * Why this exists:
 * - With OPAQUE, the server never sees raw passwords, so the browser checks
 *   breaches itself. This route relays the Have I Been Pwned (HIBP) range API
 *   for the browser.
 *
 * Privacy/Security:
 * - k-anonymity end to end: the browser sends only the first 5 hex characters
 *   of the password's SHA-1 and matches the suffix locally. The server never
 *   receives the suffix, and rejects anything but exactly 5 hex characters, so
 *   a full hash is refused rather than silently truncated.
 * - The prefix is not logged or stored, and the request carries no credentials.
 *
 * Response contract:
 * - 200 with HIBP's `SUFFIX:COUNT` lines as text/plain. HIBP pads responses
 *   (`Add-Padding`) with zero-count entries that the client must ignore.
 * - 400 for an invalid prefix; 429 when rate limited; 502 when HIBP is
 *   unreachable or fails. The client treats every non-200 as "skipped".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 5000;

const prefixSchema = z.string().regex(/^[0-9A-F]{5}$/);

const failure = (status: number) =>
  new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const { limited, retryAfter } = publicLimiter.check(
    getClientIp(request.headers)
  );
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const parsed = prefixSchema.safeParse(
    new URL(request.url).searchParams.get("prefix")?.toUpperCase()
  );
  if (!parsed.success) {
    return failure(400);
  }

  try {
    const upstream = await fetch(
      `https://api.pwnedpasswords.com/range/${parsed.data}`,
      {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        ]),
        headers: {
          "Add-Padding": "true",
          "User-Agent": "Zentity Password Checker",
        },
      }
    );
    if (!upstream.ok) {
      return failure(502);
    }

    return new NextResponse(await upstream.text(), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return failure(502);
  }
}
