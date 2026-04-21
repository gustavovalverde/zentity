import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { validityNotice } from "@/lib/db/schema";
import {
  findProviderByClientId,
  PROVIDER_IDS,
  readDcrClientId,
} from "@/lib/dcr";
import { env } from "@/lib/env";

const RP_VALIDITY_EVENT_URI = "https://zentity.xyz/events/validity-change";
const OIDC_DISCOVERY_TTL_MS = 5 * 60 * 1000;

interface OidcDiscovery {
  issuer: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

let cached: {
  expiresAt: number;
  value: OidcDiscovery;
} | null = null;

async function getOidcConfig(): Promise<OidcDiscovery> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const discoveryUrl = `${env.ZENTITY_URL}/.well-known/openid-configuration`;
  const response = await fetch(discoveryUrl);
  const metadata = (await response.json()) as {
    issuer: string;
    jwks_uri: string;
  };

  cached = {
    value: {
      issuer: metadata.issuer,
      jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)),
    },
    expiresAt: Date.now() + OIDC_DISCOVERY_TTL_MS,
  };

  return cached.value;
}

async function getAllClientIds(): Promise<string[]> {
  const clientIds: string[] = [];

  for (const providerId of PROVIDER_IDS) {
    const clientId = await readDcrClientId(providerId);
    if (clientId) {
      clientIds.push(clientId);
    }
  }

  return clientIds;
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
    const oidc = await getOidcConfig();
    const clientIds = await getAllClientIds();
    if (clientIds.length === 0) {
      return NextResponse.json(
        { error: "No registered clients — cannot validate validity notice" },
        { status: 503 }
      );
    }

    const { payload } = await jwtVerify(token, oidc.jwks, {
      issuer: oidc.issuer,
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

    const providerId = await findProviderByClientId(aud);
    if (!providerId) {
      return NextResponse.json(
        { error: "Unknown client audience" },
        { status: 400 }
      );
    }

    await getDb()
      .insert(validityNotice)
      .values({
        jti: payload.jti,
        providerId,
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
