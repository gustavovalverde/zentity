import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRedirectUri, setRpFlow } from "@/lib/rp-flow";

/**
 * RP authorization entrypoint (OAuth-style, minimal)
 *
 * Accepts an RP request and swaps potentially-sensitive query params for a short-lived `flow`
 * stored in an httpOnly cookie, then redirects to a clean URL:
 *
 *   /api/rp/authorize?client_id=...&redirect_uri=...&state=...
 *     -> 302 /rp/verify?flow=...
 *
 * Security goals:
 * - Prevent leaking params via browser history, screenshots, analytics, referer headers, etc.
 * - Prevent open redirects by enforcing `RP_ALLOWED_REDIRECT_URIS` for external redirect targets.
 *
 * This is intentionally *not* a full OAuth server (no PKCE / client secrets / consent / scopes).
 */
const querySchema = z.object({
  client_id: z.uuid(),
  redirect_uri: z.string().min(1),
  state: z.string().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { client_id: clientId, redirect_uri: redirectUri, state } = parsed.data;

  if (!isAllowedRedirectUri(redirectUri)) {
    return NextResponse.json(
      { error: "redirect_uri not allowed" },
      { status: 400 },
    );
  }

  const flowId = crypto.randomUUID();
  await setRpFlow(flowId, {
    clientId,
    redirectUri,
    state,
    createdAtMs: Date.now(),
  });

  const url = new URL(`/rp/verify?flow=${flowId}`, request.nextUrl.origin);
  return NextResponse.redirect(url);
}
