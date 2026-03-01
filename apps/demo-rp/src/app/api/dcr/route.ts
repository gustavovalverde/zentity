import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  dcrPath,
  isValidProviderId,
  readDcrClientId,
  resolveClientId,
} from "@/lib/dcr";
import { env } from "@/lib/env";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("providerId");

  if (!(providerId && isValidProviderId(providerId))) {
    return NextResponse.json(
      { error: "Invalid or missing providerId" },
      { status: 400 }
    );
  }

  const dcrClientId = readDcrClientId(providerId);
  if (dcrClientId) {
    return NextResponse.json({
      registered: true,
      client_id: dcrClientId,
      source: "dcr",
    });
  }

  const clientId = resolveClientId(providerId);
  if (!clientId.startsWith("pending-dcr-")) {
    return NextResponse.json({
      registered: true,
      client_id: clientId,
      source: "preset",
    });
  }

  return NextResponse.json({ registered: false });
}

const postSchema = z.object({
  providerId: z.string(),
  clientName: z.string().min(1),
  scopes: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = postSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "providerId, clientName, and scopes are required" },
      { status: 400 }
    );
  }

  const { providerId, clientName, scopes } = parsed.data;

  if (!isValidProviderId(providerId)) {
    return NextResponse.json({ error: "Invalid providerId" }, { status: 400 });
  }

  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/zentity-${providerId}`;

  const response = await fetch(`${env.ZENTITY_URL}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      scope: scopes,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: `DCR failed: ${text}` },
      { status: response.status }
    );
  }

  const result = (await response.json()) as { client_id: string };

  const filePath = dcrPath(providerId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify({ client_id: result.client_id }));

  return NextResponse.json({
    client_id: result.client_id,
    redirect_uri: redirectUri,
  });
}
