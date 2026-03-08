import { NextResponse } from "next/server";
import { z } from "zod";

import { isValidProviderId, readDcrClient } from "@/lib/dcr";
import { env } from "@/lib/env";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

/**
 * POST /api/ciba — Handles two actions:
 * - action: "authorize" → Initiates a CIBA backchannel auth request
 * - action: "token"     → Polls the token endpoint for CIBA grant
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("authorize"),
    providerId: z.string(),
    loginHint: z.string().min(1),
    scope: z.string().min(1),
    bindingMessage: z.string().optional(),
    authorizationDetails: z.string().optional(),
  }),
  z.object({
    action: z.literal("token"),
    providerId: z.string(),
    authReqId: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const data = parsed.data;

  if (!isValidProviderId(data.providerId)) {
    return NextResponse.json({ error: "Invalid providerId" }, { status: 400 });
  }

  const client = await readDcrClient(data.providerId);
  if (!client) {
    return NextResponse.json(
      { error: "Client not registered. Register first." },
      { status: 400 }
    );
  }

  if (data.action === "authorize") {
    const res = await fetch(`${env.ZENTITY_URL}/api/auth/oauth2/bc-authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: client.clientId,
        ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
        scope: data.scope,
        login_hint: data.loginHint,
        binding_message: data.bindingMessage,
        authorization_details: data.authorizationDetails,
      }),
    });

    const body = await res.json();
    if (!res.ok) {
      return NextResponse.json(body, { status: res.status });
    }

    return NextResponse.json(body);
  }

  // action === "token"
  const res = await fetch(`${env.ZENTITY_URL}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: CIBA_GRANT_TYPE,
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      auth_req_id: data.authReqId,
    }),
  });

  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
