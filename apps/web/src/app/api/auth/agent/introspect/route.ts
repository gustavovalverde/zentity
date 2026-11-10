import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getAapClaimsFromPayload } from "@/lib/agents/claims";
import { observeSessionLifecycle } from "@/lib/agents/session";
import { resolveTokenSnapshotForTokenJti } from "@/lib/agents/token-snapshot";
import {
  resolveSubForClient,
  resolveUserIdFromSubForClient,
} from "@/lib/auth/oidc/pairwise";
import { introspectZentityAccessToken } from "@/lib/auth/oidc/resource-principal";
import { requireClientCredentials } from "@/lib/auth/resource-auth";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

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

async function findClient(clientId: string) {
  const row = await db
    .select({
      redirectUris: oauthClients.redirectUris,
      subjectType: oauthClients.subjectType,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
  return row
    ? {
        subjectType: row.subjectType,
        redirectUris: parseStoredStringArray(row.redirectUris),
      }
    : undefined;
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

  const presented = await introspectZentityAccessToken(token);
  const { payload } = presented;
  if (payload.active !== true) {
    return NextResponse.json({ active: false });
  }
  const isJwt = presented.format === "jwt";

  const tokenClientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined;
  if (!tokenClientId) {
    return NextResponse.json({ active: false });
  }

  const [tokenClient, callerClient] = await Promise.all([
    findClient(tokenClientId),
    findClient(authResult.principal.clientId),
  ]);

  const tokenScopes =
    typeof payload.scope === "string" ? payload.scope : undefined;

  // A JWT carries the subject its client knows the user by; introspection of
  // an opaque token reports the user id itself.
  let rawUserId: string | null = null;
  if (typeof payload.sub === "string") {
    if (!isJwt) {
      rawUserId = payload.sub;
    } else if (tokenClient) {
      rawUserId = await resolveUserIdFromSubForClient(payload.sub, tokenClient);
    }
  }

  let projectedSub: string | undefined;
  if (rawUserId) {
    projectedSub = callerClient
      ? await resolveSubForClient(rawUserId, callerClient)
      : rawUserId;
  }

  let tokenSnapshot: Awaited<
    ReturnType<typeof resolveTokenSnapshotForTokenJti>
  > = null;
  const snapshotKey = isJwt ? payload.jti : payload.reference_id;
  if (typeof snapshotKey === "string") {
    tokenSnapshot = await resolveTokenSnapshotForTokenJti(
      snapshotKey,
      authResult.principal.clientId
    );
  }
  if (!tokenSnapshot) {
    return NextResponse.json({ active: false });
  }

  const embeddedAccessTokenClaims = isJwt
    ? getAapClaimsFromPayload(payload as Record<string, unknown>)
    : {};
  const responseAccessTokenClaims =
    Object.keys(embeddedAccessTokenClaims).length > 0
      ? embeddedAccessTokenClaims
      : tokenSnapshot.claims;

  const lifecycle = await observeSessionLifecycle(tokenSnapshot.sessionId);
  if (!lifecycle) {
    return NextResponse.json({ active: false });
  }

  if (lifecycle.status !== "active") {
    return NextResponse.json({
      active: false,
      client_id: tokenClientId,
      ...(tokenScopes ? { scope: tokenScopes } : {}),
      zentity: {
        attestation: tokenSnapshot.attestation,
        lifecycle: serializeLifecycle(lifecycle),
      },
    });
  }

  return NextResponse.json({
    active: true,
    client_id: tokenClientId,
    ...(tokenScopes ? { scope: tokenScopes } : {}),
    ...(projectedSub ? { sub: projectedSub } : {}),
    ...(isJwt && payload.aud ? { aud: payload.aud } : {}),
    ...responseAccessTokenClaims,
    zentity: {
      attestation: tokenSnapshot.attestation,
      lifecycle: serializeLifecycle(lifecycle),
    },
  });
}
