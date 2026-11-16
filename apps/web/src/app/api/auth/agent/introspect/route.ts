import { decodeJwt } from "jose";
import { NextResponse } from "next/server";

import {
  agentApprovalFor,
  findApprovalForToken,
} from "@/lib/agents/approval-record";
import { observeSessionLifecycle } from "@/lib/agents/session";
import { resolveSubForClientId } from "@/lib/auth/oidc/pairwise";
import {
  introspectZentityAccessToken,
  withNextDpopNonce,
} from "@/lib/auth/oidc/resource-principal";
import {
  type ClientCredentialsPrincipal,
  requireClientCredentials,
} from "@/lib/auth/resource-auth";

export const runtime = "nodejs";

/** RFC 7662 §2.2: an inactive answer says nothing else. */
function inactive(): Response {
  return NextResponse.json({ active: false });
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

/**
 * The subjects the token itself presents. A JWT names the user and the agent
 * for its audience; the provider's payload restores the user id instead. An
 * opaque token, which only its issuing client may introspect, names the user
 * by that client's subject and stores its own `act`.
 */
async function ownSubjects(
  token: string,
  format: "jwt" | "opaque",
  payload: Record<string, unknown>,
  clientId: string
): Promise<{ act: unknown; sub: string | null }> {
  if (format === "jwt") {
    const claims = decodeJwt(token);
    return { sub: claims.sub ?? null, act: claims.act };
  }
  const sub =
    typeof payload.sub === "string"
      ? await resolveSubForClientId(payload.sub, clientId)
      : null;
  return { sub, act: payload.act };
}

async function introspect(
  request: Request,
  principal: ClientCredentialsPrincipal
): Promise<Response> {
  const token = await extractToken(request);
  if (!token) {
    return inactive();
  }

  const { format, payload } = await introspectZentityAccessToken(
    token,
    principal.clientId
  );
  const tokenClientId = payload.client_id;
  if (payload.active !== true || typeof tokenClientId !== "string") {
    return inactive();
  }

  const key = format === "jwt" ? payload.jti : payload.reference_id;
  const approval =
    typeof key === "string"
      ? await findApprovalForToken(
          format === "jwt" ? { jti: key } : { referenceId: key }
        )
      : null;
  const agent = approval ? agentApprovalFor(approval) : null;
  if (!agent) {
    return inactive();
  }
  const lifecycle = await observeSessionLifecycle(agent.sessionId);
  if (lifecycle?.status !== "active") {
    return inactive();
  }

  const own = await ownSubjects(token, format, payload, tokenClientId);
  return NextResponse.json({
    active: true,
    client_id: tokenClientId,
    ...(typeof payload.scope === "string" ? { scope: payload.scope } : {}),
    ...(own.sub ? { sub: own.sub } : {}),
    ...(format === "jwt" && payload.aud ? { aud: payload.aud } : {}),
    ...(typeof payload.iat === "number" ? { iat: payload.iat } : {}),
    ...(typeof payload.exp === "number" ? { exp: payload.exp } : {}),
    ...(own.act ? { act: own.act } : {}),
    ...agent.authorization,
    zentity: { attestation: agent.attestation, lifecycle: lifecycle.status },
  });
}
