import { proxyPaymentEvents } from "@/lib/zpay-client";

/**
 * GET /api/aether/payments/[id]/events
 *
 * SSE proxy. The browser bridge connects to this route; this route
 * pipes the upstream stream from zpay through unchanged so the
 * browser EventSource never sees zpay's URL. `runtime = "nodejs"`
 * picks the Node runtime (Fluid Compute supports streaming on Node);
 * `dynamic = "force-dynamic"` opts out of any caching layer between
 * the client and the upstream stream.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return proxyPaymentEvents(id, request);
}
