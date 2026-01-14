import { jsonResponse, optionsResponse } from "@/lib/cors";
import { getRequest, updateRequest } from "@/lib/demo-store";
import { verifyPresentation } from "@/lib/zentity-client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const request = getRequest(id);
  if (!request) {
    return jsonResponse({ error: "Request not found" }, 404);
  }

  let payload: { vp_token?: string } = {};
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    payload = {};
  }

  const vpToken = payload.vp_token;
  if (!vpToken) {
    return jsonResponse({ error: "vp_token required" }, 400);
  }

  try {
    const result = await verifyPresentation(vpToken);
    const updated = updateRequest(id, {
      status: "verified",
      result,
    });
    return jsonResponse({ ok: true, request: updated });
  } catch (error) {
    const updated = updateRequest(id, {
      status: "failed",
      result: {
        error: error instanceof Error ? error.message : "verification failed",
      },
    });
    return jsonResponse({ ok: false, request: updated }, 400);
  }
}

export async function OPTIONS() {
  return optionsResponse();
}
