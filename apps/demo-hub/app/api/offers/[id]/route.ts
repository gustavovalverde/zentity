import { jsonResponse, optionsResponse } from "@/lib/cors";
import { getOffer } from "@/lib/demo-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const offer = getOffer(id);
  if (!offer) {
    return jsonResponse({ error: "Offer not found" }, 404);
  }
  return jsonResponse({ ok: true, offer });
}

export async function OPTIONS() {
  return optionsResponse();
}
