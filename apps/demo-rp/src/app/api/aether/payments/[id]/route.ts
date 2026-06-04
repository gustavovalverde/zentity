import { NextResponse } from "next/server";

import { getPaymentStatus } from "@/lib/zpay-client";

/**
 * GET /api/aether/payments/[id]
 *
 * REST snapshot of the prepared payment, proxied to zpay. The bridge
 * uses this for initial state and as a fallback when the SSE stream
 * has not delivered a snapshot yet (e.g., immediately after the
 * EventSource reconnects).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const snapshot = await getPaymentStatus(id);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "status read failed";
    return NextResponse.json(
      { error: "zpay_status_failed", error_description: message },
      { status: 502 }
    );
  }
}
