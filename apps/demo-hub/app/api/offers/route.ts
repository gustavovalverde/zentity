import { jsonResponse, optionsResponse } from "@/lib/cors";
import { createOffer } from "@/lib/demo-store";
import { createCredentialOffer } from "@/lib/zentity-client";

export async function POST(req: Request) {
  let payload: { scenarioId?: string; credentialConfigurationId?: string } = {};
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    payload = {};
  }

  const scenarioId = payload.scenarioId ?? "exchange";
  const credentialConfigurationId =
    payload.credentialConfigurationId ?? "zentity_identity";

  try {
    const result = await createCredentialOffer(credentialConfigurationId);
    const offer = createOffer({
      scenarioId,
      issuer: result.issuer,
      credentialConfigurationId,
      offer: result.offer,
    });
    return jsonResponse({
      ok: true,
      offerId: offer.id,
      offer: offer.offer,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Offer failed" },
      500
    );
  }
}

export async function OPTIONS() {
  return optionsResponse();
}
