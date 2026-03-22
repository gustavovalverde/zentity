import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireClientCredentials } from "@/lib/auth/api-auth";
import {
  resolveSubForClient,
  resolveUserIdFromSubForClient,
} from "@/lib/auth/oidc/pairwise";
import {
  loadAapProfileForTokenJti,
  readAapProfileFromPayload,
} from "@/lib/ciba/aap-profile";
import { observeSessionLifecycle } from "@/lib/ciba/agent-lifecycle";
import { db } from "@/lib/db/connection";
import {
  oauthAccessTokens,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";
import { verifyAuthIssuedJwt } from "@/lib/trpc/jwt-session";

export const runtime = "nodejs";

function serializeLifecycle(
  lifecycle: NonNullable<Awaited<ReturnType<typeof observeSessionLifecycle>>>
) {
  return {
    created_at: Math.floor(lifecycle.createdAt.getTime() / 1000),
    idle_expires_at: Math.floor(lifecycle.idleExpiresAt.getTime() / 1000),
    last_active_at: Math.floor(lifecycle.lastActiveAt.getTime() / 1000),
    max_expires_at: Math.floor(lifecycle.maxExpiresAt.getTime() / 1000),
    status: lifecycle.status,
  };
}

async function extractToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    return (formData.get("token") as string | null) ?? null;
  }

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      token?: string;
    } | null;
    return body?.token ?? null;
  }

  return null;
}

function findAccessToken(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("base64url");
  return db
    .select({
      clientId: oauthAccessTokens.clientId,
      expiresAt: oauthAccessTokens.expiresAt,
      referenceId: oauthAccessTokens.referenceId,
      scopes: oauthAccessTokens.scopes,
      userId: oauthAccessTokens.userId,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, tokenHash))
    .limit(1)
    .get();
}

function findClient(clientId: string) {
  return db
    .select({
      redirectUris: oauthClients.redirectUris,
      subjectType: oauthClients.subjectType,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
}

export async function POST(request: Request) {
  const authResult = await requireClientCredentials(request, [
    "agent:introspect",
  ]);
  if (!authResult.ok) {
    return authResult.response;
  }

  const token = await extractToken(request);
  if (!token) {
    return NextResponse.json({ active: false });
  }

  const payload = token.startsWith("eyJ")
    ? await verifyAuthIssuedJwt(token)
    : null;
  if (token.startsWith("eyJ") && !payload) {
    return NextResponse.json({ active: false });
  }

  const opaqueToken = token.startsWith("eyJ")
    ? null
    : await findAccessToken(token);
  if (opaqueToken && opaqueToken.expiresAt < new Date()) {
    return NextResponse.json({ active: false });
  }

  const tokenClientId =
    (payload?.client_id as string | undefined) ??
    (payload?.azp as string | undefined) ??
    opaqueToken?.clientId;
  if (!tokenClientId) {
    return NextResponse.json({ active: false });
  }

  const [tokenClient, callerClient] = await Promise.all([
    findClient(tokenClientId),
    findClient(authResult.principal.clientId),
  ]);

  const tokenScopes =
    typeof payload?.scope === "string" ? payload.scope : opaqueToken?.scopes;

  let rawUserId = opaqueToken?.userId ?? null;
  if (!rawUserId && typeof payload?.sub === "string") {
    rawUserId = tokenClient
      ? ((await resolveUserIdFromSubForClient(payload.sub, tokenClient)) ??
        payload.sub)
      : payload.sub;
  }

  let projectedSub: string | undefined;
  if (rawUserId) {
    projectedSub = callerClient
      ? await resolveSubForClient(rawUserId, callerClient)
      : rawUserId;
  }

  let snapshot: Awaited<ReturnType<typeof loadAapProfileForTokenJti>> = null;
  if (typeof payload?.jti === "string") {
    snapshot = await loadAapProfileForTokenJti(
      payload.jti,
      authResult.principal.clientId
    );
  } else if (opaqueToken?.referenceId) {
    snapshot = await loadAapProfileForTokenJti(
      opaqueToken.referenceId,
      authResult.principal.clientId
    );
  }
  if (!snapshot) {
    return NextResponse.json({ active: false });
  }

  const payloadAap =
    payload && typeof payload === "object"
      ? readAapProfileFromPayload(payload as Record<string, unknown>)
      : {};

  const lifecycle = await observeSessionLifecycle(snapshot.sessionId);
  if (!lifecycle) {
    return NextResponse.json({ active: false });
  }

  if (lifecycle.status !== "active") {
    return NextResponse.json({
      active: false,
      client_id: tokenClientId,
      ...(tokenScopes ? { scope: tokenScopes } : {}),
      zentity: {
        attestation: snapshot.attestation,
        lifecycle: serializeLifecycle(lifecycle),
      },
    });
  }

  return NextResponse.json({
    active: true,
    client_id: tokenClientId,
    ...(tokenScopes ? { scope: tokenScopes } : {}),
    ...(projectedSub ? { sub: projectedSub } : {}),
    ...(payload?.aud ? { aud: payload.aud } : {}),
    ...snapshot.aap,
    ...(payloadAap.delegation ? { delegation: payloadAap.delegation } : {}),
    zentity: {
      attestation: snapshot.attestation,
      lifecycle: serializeLifecycle(lifecycle),
    },
  });
}
