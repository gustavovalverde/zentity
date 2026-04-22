import crypto from "node:crypto";

import {
  createDpopClient,
  type DpopClient,
  fetchUserInfo,
} from "@zentity/sdk/rp";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareAgentAssertionForProvider } from "@/lib/agent-runtime";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/connection";
import { cibaPings } from "@/lib/db/schema";
import { isValidProviderId, readDcrClient } from "@/lib/dcr";
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
const TOKEN_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";
const MERCHANT_RESOURCE = "https://merchant.example.com/api";
const EXCHANGE_SCOPE = "openid";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("authorize"),
    providerId: z.string(),
    loginHint: z.string().min(1),
    scope: z.string().min(1),
    bindingMessage: z.string().optional(),
    authorizationDetails: z.string().optional(),
    acrValues: z.string().optional(),
    trustTier: z.enum(["anonymous", "registered", "attested"]).optional(),
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
    bindingMessage?: string | undefined;
    authorizationDetails?: string | undefined;
    acrValues?: string | undefined;
  },
  client: DcrClient,
  agentAssertion: string | null
) {
  const notificationToken = crypto.randomUUID();
  const callbackUrl = `${env.NEXT_PUBLIC_APP_URL}/api/ciba/callback`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(agentAssertion ? { "Agent-Assertion": agentAssertion } : {}),
  };

  const res = await fetch(`${env.ZENTITY_URL}/api/auth/oauth2/bc-authorize`, {
    method: "POST",
    headers,
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
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const bindingMessage =
      data.bindingMessage ??
      "Aether AI requests approval for a delegated action";

    let agentAssertion: string | null = null;
    try {
      agentAssertion = await prepareAgentAssertionForProvider({
        bindingMessage,
        providerId: data.providerId,
        ...(data.trustTier ? { trustTier: data.trustTier } : {}),
        userId: session.user.id,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Agent assertion failed";
      console.error("[CIBA] Agent assertion failed:", message);
      return NextResponse.json(
        { error: "agent_assertion_error", error_description: message },
        { status: 500 }
      );
    }

    return handleAuthorize({ ...data, bindingMessage }, client, agentAssertion);
  }

  const tokenUrl = `${env.ZENTITY_URL}/api/auth/oauth2/token`;

  if (data.action === "token-exchange") {
    return handleTokenExchange(data, client, tokenUrl);
  }

  return handleCibaToken(data, client, tokenUrl);
}

async function handleTokenExchange(
  data: Extract<z.infer<typeof bodySchema>, { action: "token-exchange" }>,
  client: { clientId: string; clientSecret: string | null },
  tokenUrl: string
): Promise<NextResponse> {
  const params: Record<string, string> = {
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    client_id: client.clientId,
    subject_token: data.accessToken,
    subject_token_type: TOKEN_TYPE_ACCESS_TOKEN,
    resource: MERCHANT_RESOURCE,
    scope: EXCHANGE_SCOPE,
  };
  if (client.clientSecret) {
    params.client_secret = client.clientSecret;
  }

  const { body, status } = await fetchTokenWithDpop(tokenUrl, params);
  return NextResponse.json(body, { status });
}

async function handleCibaToken(
  data: Extract<z.infer<typeof bodySchema>, { action: "token" }>,
  client: { clientId: string; clientSecret: string | null },
  tokenUrl: string
): Promise<NextResponse> {
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

  if (
    status < 200 ||
    status >= 300 ||
    typeof cibaBody.access_token !== "string"
  ) {
    return NextResponse.json(body, { status });
  }

  const userinfo = await readUserInfo(cibaTokenDpop, cibaBody.access_token);
  return userinfo
    ? NextResponse.json({ ...cibaBody, userinfo }, { status })
    : NextResponse.json(body, { status });
}

async function readUserInfo(
  dpop: Awaited<ReturnType<typeof fetchTokenWithDpop>>["dpop"],
  accessToken: string
): Promise<Record<string, unknown> | null> {
  try {
    return await fetchUserInfo({
      accessToken,
      dpopClient: dpop,
      unwrapResponseEnvelope: false,
      userInfoUrl: new URL("/api/auth/oauth2/userinfo", env.ZENTITY_URL),
    });
  } catch {
    // Non-critical — return tokens without userinfo
  }
  return null;
}
