import { NextResponse } from "next/server";

import { observeSessionLifecycle } from "@/lib/agents/session";
import { resolveTokenSnapshotForTokenJti } from "@/lib/agents/token-snapshot";
import {
  findPairwiseClient,
  resolveSubForClient,
} from "@/lib/auth/oidc/pairwise";
import {
  introspectZentityAccessToken,
  withNextDpopNonce,
} from "@/lib/auth/oidc/resource-principal";
import {
  type ClientCredentialsPrincipal,
  requireClientCredentials,
} from "@/lib/auth/resource-auth";

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

export async function POST(request: Request) {
  const authResult = await requireClientCredentials(request, [
    "agent:introspect",
  ]);
  if (!authResult.ok) {
    return authResult.response;
  }
  return withNextDpopNonce(
    await introspect(request, authResult.principal),
    authResult.dpopNonce
  );
}

async function introspect(
  request: Request,
  principal: ClientCredentialsPrincipal
): Promise<Response> {
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

  const callerClient = await findPairwiseClient(principal.clientId);

  const tokenScopes =
    typeof payload.scope === "string" ? payload.scope : undefined;

  // The provider reports the user id for both formats: it restores a pairwise
  // JWT's user from `ba_sub`.
  const rawUserId = typeof payload.sub === "string" ? payload.sub : null;

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
    tokenSnapshot = await resolveTokenSnapshotForTokenJti(snapshotKey);
  }
  if (!tokenSnapshot) {
    return NextResponse.json({ active: false });
  }

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
    ...(payload.act ? { act: payload.act } : {}),
    ...tokenSnapshot.authorization,
    zentity: {
      attestation: tokenSnapshot.attestation,
      lifecycle: serializeLifecycle(lifecycle),
    },
  });
}
