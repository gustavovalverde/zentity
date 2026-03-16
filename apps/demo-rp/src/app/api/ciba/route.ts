import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db/connection";
import { cibaPings } from "@/lib/db/schema";
import { isValidProviderId, readDcrClient } from "@/lib/dcr";
import { createDpopClient, type DpopClient } from "@/lib/dpop";
import { env } from "@/lib/env";

const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

/**
 * POST /api/ciba — Handles three actions:
 * - action: "authorize" → Initiates a CIBA backchannel auth request (ping mode)
 * - action: "token"     → Polls the token endpoint for CIBA grant
 * - action: "check-ping" → Checks if a ping callback has been received
 */
const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
const TOKEN_TYPE_ACCESS = "urn:ietf:params:oauth:token-type:access_token";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("authorize"),
    providerId: z.string(),
    loginHint: z.string().min(1),
    scope: z.string().min(1),
    bindingMessage: z.string().optional(),
    authorizationDetails: z.string().optional(),
    acrValues: z.string().optional(),
  }),
  z.object({
    action: z.literal("token"),
    providerId: z.string(),
    authReqId: z.string().min(1),
  }),
  z.object({
    action: z.literal("check-ping"),
    authReqId: z.string().min(1),
  }),
  z.object({
    action: z.literal("token-exchange"),
    providerId: z.string(),
    accessToken: z.string().min(1),
    resource: z.string().min(1),
    scope: z.string().optional(),
  }),
]);

interface DcrClient {
  clientId: string;
  clientSecret: string | null;
}

async function handleAuthorize(
  data: {
    scope: string;
    loginHint: string;
    bindingMessage?: string;
    authorizationDetails?: string;
    acrValues?: string;
  },
  client: DcrClient
) {
  const notificationToken = crypto.randomUUID();
  const callbackUrl = `${env.NEXT_PUBLIC_APP_URL}/api/ciba/callback`;

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
      ...(data.acrValues ? { acr_values: data.acrValues } : {}),
      resource: env.ZENTITY_URL,
      client_notification_token: notificationToken,
      client_notification_uri: callbackUrl,
    }),
  });

  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return NextResponse.json(body, { status: res.status });
  }

  const authReqId = body.auth_req_id as string;
  if (authReqId) {
    await getDb()
      .insert(cibaPings)
      .values({ authReqId, notificationToken })
      .onConflictDoNothing();
  }

  return NextResponse.json(body);
}

async function fetchTokenWithDpop(
  tokenUrl: string,
  params: Record<string, string>
): Promise<{ body: unknown; dpop: DpopClient; status: number }> {
  const dpop = await createDpopClient();
  const { response, result } = await dpop.withNonceRetry(async (nonce) => {
    const proof = await dpop.proofFor("POST", tokenUrl, undefined, nonce);
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: proof,
      },
      body: new URLSearchParams(params),
    });
    return { response, result: await response.json() };
  });
  return { body: result, dpop, status: response.status };
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const data = parsed.data;

  if (data.action === "check-ping") {
    const row = await getDb().query.cibaPings.findFirst({
      where: eq(cibaPings.authReqId, data.authReqId),
      columns: { received: true },
    });
    return NextResponse.json({ received: row?.received ?? false });
  }

  if (!("providerId" in data && isValidProviderId(data.providerId))) {
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
    return handleAuthorize(data, client);
  }

  const tokenUrl = `${env.ZENTITY_URL}/api/auth/oauth2/token`;

  if (data.action === "token-exchange") {
    const params: Record<string, string> = {
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      client_id: client.clientId,
      subject_token: data.accessToken,
      subject_token_type: TOKEN_TYPE_ACCESS,
      resource: data.resource,
    };
    if (client.clientSecret) {
      params.client_secret = client.clientSecret;
    }
    if (data.scope) {
      params.scope = data.scope;
    }

    const { body, status } = await fetchTokenWithDpop(tokenUrl, params);
    return NextResponse.json(body, { status });
  }

  // action === "token"
  const params: Record<string, string> = {
    grant_type: CIBA_GRANT_TYPE,
    client_id: client.clientId,
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    auth_req_id: data.authReqId,
    resource: env.ZENTITY_URL,
  };

  const {
    body,
    dpop: cibaTokenDpop,
    status,
  } = await fetchTokenWithDpop(tokenUrl, params);
  const cibaBody = body as Record<string, unknown>;

  // If token fetch succeeded, immediately fetch userinfo with the same DPoP keypair
  if (
    status >= 200 &&
    status < 300 &&
    typeof cibaBody.access_token === "string"
  ) {
    try {
      const userinfoUrl = new URL(
        "/api/auth/oauth2/userinfo",
        env.ZENTITY_URL
      ).toString();
      const proof = await cibaTokenDpop.proofFor(
        "GET",
        userinfoUrl,
        cibaBody.access_token
      );
      const uiRes = await fetch(userinfoUrl, {
        headers: {
          Authorization: `DPoP ${cibaBody.access_token}`,
          DPoP: proof,
        },
      });
      if (uiRes.ok) {
        const userinfo = (await uiRes.json()) as Record<string, unknown>;
        return NextResponse.json({ ...cibaBody, userinfo }, { status });
      }
    } catch {
      // Non-critical — return tokens without userinfo
    }
  }

  return NextResponse.json(body, { status });
}
