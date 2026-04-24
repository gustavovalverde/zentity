import { NextResponse } from "next/server";
import { z } from "zod";

import { readDcrClientId, saveDcrClientId } from "@/lib/dcr";
import { env } from "@/lib/env";
import {
  getRouteScenario,
  isRouteScenarioId,
  ROUTE_SCENARIO_IDS,
} from "@/scenarios/route-scenario-registry";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const scenarioId = searchParams.get("scenarioId");

  if (!(scenarioId && isRouteScenarioId(scenarioId))) {
    return NextResponse.json(
      { error: "Invalid or missing scenarioId" },
      { status: 400 }
    );
  }

  const clientId = await readDcrClientId(scenarioId);
  if (clientId) {
    return NextResponse.json({ registered: true, client_id: clientId });
  }

  return NextResponse.json({ registered: false });
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

  const { scenarioId } = parsed.data;
  const scenario = getRouteScenario(scenarioId);
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/${scenario.oauthProviderId}`;

  try {
    const response = await fetch(
      `${env.ZENTITY_URL}/api/auth/oauth2/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: scenario.dcr.clientName,
          redirect_uris: [redirectUri],
          scope: scenario.dcr.requestedScopes,
          token_endpoint_auth_method: "none",
          grant_types: scenario.dcr.grantTypes ?? ["authorization_code"],
          response_types: ["code"],
          backchannel_logout_uri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/backchannel-logout`,
          rp_validity_notice_uri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/validity`,
          rp_validity_notice_enabled: true,
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `DCR failed: ${text}` },
        { status: response.status }
      );
    }

    const result = (await response.json()) as { client_id?: string };
    if (!result.client_id) {
      return NextResponse.json(
        { error: "DCR failed: missing client_id in registration response" },
        { status: 502 }
      );
    }

    await saveDcrClientId(scenarioId, result.client_id);

    return NextResponse.json({
      client_id: result.client_id,
      redirect_uri: redirectUri,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown DCR registration error";
    return NextResponse.json(
      { error: `Failed to persist DCR client: ${message}` },
      { status: 500 }
    );
  }
}
