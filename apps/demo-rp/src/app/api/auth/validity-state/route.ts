import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { getScenarioValidityState } from "@/lib/validity";
import { isRouteScenarioId } from "@/scenarios/route-scenario-registry";

export async function GET(request: Request): Promise<Response> {
  const scenarioId = new URL(request.url).searchParams.get("scenarioId");
  if (!(scenarioId && isRouteScenarioId(scenarioId))) {
    return NextResponse.json(
      { error: "Invalid or missing scenarioId" },
      { status: 400 }
    );
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const validityState = await getScenarioValidityState({
    scenarioId,
    userId: session.user.id,
  });

  return NextResponse.json(validityState, {
    headers: { "Cache-Control": "no-store" },
  });
}
