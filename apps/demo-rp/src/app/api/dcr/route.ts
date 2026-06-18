import { NextResponse } from "next/server";
import { z } from "zod";

import { readDcrClientId, saveDcrClientId } from "@/lib/dcr";
import { env } from "@/lib/env";
import {
  getRouteScenario,
  isRouteScenarioId,
  ROUTE_SCENARIO_IDS,
  type RouteScenarioId,
} from "@/scenarios/route-scenario-registry";

// Fixed PKCE challenge for the liveness probe. The probe never completes a flow;
// it only needs Zentity to reach the client_id check, which happens before any
// authorization code is issued, so a constant value is fine.
const PROBE_CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function scenarioRedirectUri(scenarioId: RouteScenarioId): string {
  const scenario = getRouteScenario(scenarioId);
  return `${env.NEXT_PUBLIC_APP_URL}/api/auth/callback/${scenario.oauthProviderId}`;
}

/**
 * Confirm a cached client_id is still registered at Zentity.
 *
 * The pushed-authorization-request endpoint validates the client before issuing
 * a request_uri: an unknown client returns 400 `invalid_client`, a live client
 * returns 200 with a (short-lived, unused) request_uri. Unlike the authorize
 * endpoint, PAR answers in JSON, so it works reliably from a server-side fetch.
 * Any non-`invalid_client` outcome is treated as live, and a network failure is
 * treated as live too, so a transient Zentity hiccup never churns registrations.
 */
async function isClientLiveAtZentity(
  scenarioId: RouteScenarioId,
  clientId: string
): Promise<boolean> {
  try {
    const response = await fetch(`${env.ZENTITY_URL}/api/auth/oauth2/par`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: scenarioRedirectUri(scenarioId),
        scope: "openid",
        code_challenge: PROBE_CODE_CHALLENGE,
        code_challenge_method: "S256",
        resource: env.ZENTITY_URL,
      }),
    });
    if (response.ok) {
      return true;
    }
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    return body?.error !== "invalid_client";
  } catch {
    return true;
  }
}

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

async function registerScenarioClient(
  scenarioId: RouteScenarioId
): Promise<string> {
  const scenario = getRouteScenario(scenarioId);
  const grantTypes = scenario.dcr.grantTypes ?? ["authorization_code"];
  const response = await fetch(`${env.ZENTITY_URL}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: scenario.dcr.clientName,
      redirect_uris: [scenarioRedirectUri(scenarioId)],
      scope: scenario.dcr.requestedScopes,
      token_endpoint_auth_method: "none",
      grant_types: grantTypes,
      response_types: ["code"],
      backchannel_logout_uri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/backchannel-logout`,
      rp_validity_notice_uri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/validity`,
      rp_validity_notice_enabled: true,
      // CIBA clients must advertise a token delivery mode; the provider rejects
      // bc-authorize otherwise. The demo agent polls the token endpoint.
      ...(grantTypes.includes(CIBA_GRANT_TYPE)
        ? { backchannel_token_delivery_mode: "poll" }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`DCR failed: ${await response.text()}`);
  }

  const result = (await response.json()) as { client_id?: string };
  if (!result.client_id) {
    throw new Error("DCR failed: missing client_id in registration response");
  }

  try {
    await saveDcrClientId(scenarioId, result.client_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to persist DCR client: ${message}`);
  }

  return result.client_id;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scenarioId = searchParams.get("scenarioId");

  if (!(scenarioId && isRouteScenarioId(scenarioId))) {
    return NextResponse.json(
      { error: "Invalid or missing scenarioId" },
      { status: 400 }
    );
  }

  const cached = await readDcrClientId(scenarioId);
  if (!cached) {
    // Never registered: keep first-time registration an explicit user action.
    return NextResponse.json({ registered: false });
  }

  try {
    // Self-heal: if Zentity has forgotten the cached client (e.g. its database
    // was reset), re-register transparently so the demo keeps working.
    const clientId = (await isClientLiveAtZentity(scenarioId, cached))
      ? cached
      : await registerScenarioClient(scenarioId);
    return NextResponse.json({ registered: true, client_id: clientId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DCR check failed";
    return NextResponse.json({ registered: false, error: message });
  }
}

const postSchema = z.object({
  scenarioId: z.enum(ROUTE_SCENARIO_IDS),
});

export async function POST(request: Request) {
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid or missing scenarioId" },
      { status: 400 }
    );
  }

  try {
    const clientId = await registerScenarioClient(parsed.data.scenarioId);
    return NextResponse.json({
      client_id: clientId,
      redirect_uri: scenarioRedirectUri(parsed.data.scenarioId),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown DCR registration error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
