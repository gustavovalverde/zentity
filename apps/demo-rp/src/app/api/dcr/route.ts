import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isValidProviderId,
  readDcrClientId,
  saveDcrClientId,
} from "@/lib/dcr";
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

  await saveDcrClientId(providerId, result.client_id);

  return NextResponse.json({
    client_id: result.client_id,
    redirect_uri: redirectUri,
  });
}
