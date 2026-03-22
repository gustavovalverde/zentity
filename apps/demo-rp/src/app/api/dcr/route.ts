import { NextResponse } from "next/server";
import { z } from "zod";

import { isValidProviderId, readDcrClientId, saveDcrClientId } from "@/lib/dcr";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("providerId");

  if (!(providerId && isValidProviderId(providerId))) {
    return NextResponse.json(
      { error: "Invalid or missing providerId" },
      { status: 400 }
    );
  }

  const clientId = await readDcrClientId(providerId);
  if (clientId) {
    return NextResponse.json({ registered: true, client_id: clientId });
  }

  return NextResponse.json({ registered: false });
}

const postSchema = z.object({
  providerId: z.string(),
  clientName: z.string().min(1),
  scopes: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .transform((v) => (Array.isArray(v) ? v.join(" ") : v)),
  grantTypes: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "providerId, clientName, and scopes are required" },
      { status: 400 }
    );
  }

  const { providerId, clientName, scopes, grantTypes } = parsed.data;

  if (!isValidProviderId(providerId)) {
    return NextResponse.json({ error: "Invalid providerId" }, { status: 400 });
  }

  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth2/callback/zentity-${providerId}`;

  try {
    const response = await fetch(
      `${env.ZENTITY_URL}/api/auth/oauth2/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          redirect_uris: [redirectUri],
          scope: scopes,
          token_endpoint_auth_method: "none",
          grant_types: grantTypes ?? ["authorization_code"],
          response_types: ["code"],
          backchannel_logout_uri: `${env.NEXT_PUBLIC_APP_URL}/api/auth/backchannel-logout`,
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

    await saveDcrClientId(providerId, result.client_id);

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
