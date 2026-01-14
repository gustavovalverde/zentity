import { jsonResponse, optionsResponse } from "@/lib/cors";
import { getRequest } from "@/lib/demo-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const request = getRequest(id);
  if (!request) {
    return jsonResponse({ error: "Request not found" }, 404);
  }
  return jsonResponse({ ok: true, request });
}

export async function OPTIONS() {
  return optionsResponse();
}
