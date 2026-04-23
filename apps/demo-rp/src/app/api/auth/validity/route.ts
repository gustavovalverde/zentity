import { createOpenIdTokenVerifier } from "@zentity/sdk/rp";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { validityNotice } from "@/lib/db/schema";
import { findRouteScenarioByClientId, readDcrClientId } from "@/lib/dcr";
import { env } from "@/lib/env";
import { ROUTE_SCENARIO_IDS } from "@/scenarios/route-scenario-registry";

const RP_VALIDITY_EVENT_URI = "https://zentity.xyz/events/validity-change";

let oidcTokenVerifier: ReturnType<typeof createOpenIdTokenVerifier> | undefined;
function getOidcTokenVerifier() {
  oidcTokenVerifier ??= createOpenIdTokenVerifier({
    issuerUrl: env.ZENTITY_URL,
  });
  return oidcTokenVerifier;
}

async function getAllClientIds(): Promise<string[]> {
  const clientIds = await Promise.all(ROUTE_SCENARIO_IDS.map(readDcrClientId));
  return clientIds.filter((id): id is string => Boolean(id));
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/jwt")) {
    return new Response(null, { status: 415 });
  }

  const token = await request.text();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const clientIds = await getAllClientIds();
    if (clientIds.length === 0) {
      return NextResponse.json(
        { error: "No registered clients — cannot validate validity notice" },
        { status: 503 }
      );
    }

    const { payload } = await getOidcTokenVerifier().verify(token, {
      audience: clientIds,
    });

    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (typeof aud !== "string") {
      return NextResponse.json(
        { error: "Missing audience claim" },
        { status: 400 }
      );
    }

    const events = payload.events as Record<
      string,
      {
        eventId?: unknown;
        eventKind?: unknown;
        occurredAt?: unknown;
        reason?: unknown;
        validityStatus?: unknown;
      }
    > | null;
    const validityEvent = events?.[RP_VALIDITY_EVENT_URI];
    if (!validityEvent) {
      return NextResponse.json(
        { error: "Missing validity-change event" },
        { status: 400 }
      );
    }

    if (
      typeof payload.jti !== "string" ||
      typeof payload.sub !== "string" ||
      typeof validityEvent.eventId !== "string" ||
      typeof validityEvent.eventKind !== "string" ||
      typeof validityEvent.validityStatus !== "string" ||
      typeof validityEvent.occurredAt !== "string"
    ) {
      return NextResponse.json(
        { error: "Malformed validity notice token" },
        { status: 400 }
      );
    }

    const scenarioId = await findRouteScenarioByClientId(aud);
    if (!scenarioId) {
      return NextResponse.json(
        { error: "Unknown client audience" },
        { status: 400 }
      );
    }

    await getDb()
      .insert(validityNotice)
      .values({
        jti: payload.jti,
        scenarioId,
        clientId: aud,
        sub: payload.sub,
        eventId: validityEvent.eventId,
        eventKind: validityEvent.eventKind,
        validityStatus: validityEvent.validityStatus,
        occurredAt: validityEvent.occurredAt,
        reason:
          typeof validityEvent.reason === "string"
            ? validityEvent.reason
            : null,
        rawToken: token,
      })
      .onConflictDoNothing()
      .run();

    return new Response(null, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "Invalid validity notice token" },
      { status: 400 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { error: "clientId is required" },
      { status: 400 }
    );
  }

  const notices = await getDb()
    .select()
    .from(validityNotice)
    .where(eq(validityNotice.clientId, clientId))
    .all();

  return NextResponse.json({ notices });
}
