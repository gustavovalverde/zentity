import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { createRpAuthorizationCode } from "@/lib/db";
import { clearRpFlow, getRpFlow } from "@/lib/rp-flow";

/**
 * RP completion endpoint (issues a one-time code and redirects back to the RP)
 *
 * This endpoint is called after the user completes verification in Zentity.
 * It requires an authenticated session, then issues a short-lived, single-use
 * authorization code bound to:
 * - client_id
 * - redirect_uri
 * - user_id
 *
 * It then redirects the user back to the RP:
 *   redirect_uri?code=...&state=...
 *
 * Privacy goal:
 * - Never put verification results, proofs, or any PII in the redirect URL.
 *
 * NOTE: This currently uses GET for simplicity; production OAuth systems
 * typically issue codes via POST + CSRF protections.
 */
const querySchema = z.object({
  flow: z.uuid(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const authResult = await requireSession();
  if (!authResult.ok) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const flowId = parsed.data.flow;
  const flow = await getRpFlow(flowId);
  if (!flow) {
    return NextResponse.json({ error: "Flow expired" }, { status: 400 });
  }

  // Issue a one-time code and redirect back (auth-code style).
  const { code } = createRpAuthorizationCode({
    clientId: flow.clientId,
    redirectUri: flow.redirectUri,
    state: flow.state,
    userId: authResult.session.user.id,
  });

  await clearRpFlow(flowId);

  // Build redirect, preserving any existing query parameters.
  let redirectUrl: URL;
  if (flow.redirectUri.startsWith("/")) {
    redirectUrl = new URL(flow.redirectUri, request.nextUrl.origin);
  } else {
    redirectUrl = new URL(flow.redirectUri);
  }
  redirectUrl.searchParams.set("code", code);
  if (flow.state) redirectUrl.searchParams.set("state", flow.state);

  return NextResponse.redirect(redirectUrl);
}
