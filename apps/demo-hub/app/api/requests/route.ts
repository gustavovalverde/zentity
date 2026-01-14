import { jsonResponse, optionsResponse } from "@/lib/cors";
import { createRequest } from "@/lib/demo-store";
import { getScenarioNonce } from "@/lib/zentity-client";

export async function POST(req: Request) {
  let payload: {
    scenarioId?: string;
    requiredClaims?: string[];
    purpose?: string;
  } = {};
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    payload = {};
  }

  const scenarioId = payload.scenarioId ?? "exchange";
  const requiredClaims = payload.requiredClaims ?? [];
  const purpose = payload.purpose ?? "Demo presentation request.";
  const nonce = getScenarioNonce();

  const request = createRequest({
    scenarioId,
    requiredClaims,
    purpose,
    nonce,
  });

  return jsonResponse({
    ok: true,
    requestId: request.id,
    request,
  });
}

export async function OPTIONS() {
  return optionsResponse();
}
