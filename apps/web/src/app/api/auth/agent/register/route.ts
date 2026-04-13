import { eq } from "drizzle-orm";
import { importJWK, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createPendingSessionGrants,
  ensureDefaultHostPolicies,
  seedSessionGrantsFromHostPolicies,
} from "@/lib/agents/approval-evaluate";
import {
  AGENT_SESSION_REGISTER_SCOPE,
  registerSessionRequestSchema,
} from "@/lib/agents/session";
import { computeJwkThumbprint } from "@/lib/auth/oidc/oauth-request";
import { requireBootstrapAccessToken } from "@/lib/auth/resource-auth";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import {
  ATTESTED_HOST_POLICY_CAPABILITIES,
  DEFAULT_HOST_POLICY_CAPABILITIES,
  ensureCapabilitiesSeeded,
} from "@/lib/db/seed";

export const runtime = "nodejs";

function decodeHostJwtIssuer(hostJwt: string): string | null {
  try {
    const payloadB64 = hostJwt.split(".")[1];
    if (!payloadB64) {
      return null;
    }
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8")
    ) as { iss?: string };
    return typeof payload.iss === "string" ? payload.iss : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authResult = await requireBootstrapAccessToken(request, [
    AGENT_SESSION_REGISTER_SCOPE,
  ]);
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }

  const { principal } = authResult;
  const {
    hostJwt,
    agentPublicKey,
    requestedCapabilities = [],
    display,
  } = parsed.data;

  const hostId = decodeHostJwtIssuer(hostJwt);
  if (!hostId) {
    return NextResponse.json(
      { error: "Invalid host JWT: cannot decode issuer" },
      { status: 400 }
    );
  }

  const host = await db
    .select({
      attestationTier: agentHosts.attestationTier,
      clientId: agentHosts.clientId,
      id: agentHosts.id,
      publicKey: agentHosts.publicKey,
      status: agentHosts.status,
      userId: agentHosts.userId,
    })
    .from(agentHosts)
    .where(eq(agentHosts.id, hostId))
    .limit(1)
    .get();
  if (!host) {
    return NextResponse.json({ error: "Host not found" }, { status: 404 });
  }

  if (
    host.userId !== principal.userId ||
    host.clientId !== principal.clientId
  ) {
    return NextResponse.json(
      { error: "Host does not belong to the caller" },
      { status: 403 }
    );
  }

  if (host.status !== "active") {
    return NextResponse.json({ error: "Host is not active" }, { status: 403 });
  }

  try {
    const publicKey = await importJWK(JSON.parse(host.publicKey), "EdDSA");
    await jwtVerify(hostJwt, publicKey, {
      algorithms: ["EdDSA"],
      issuer: hostId,
      subject: "agent-registration",
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid host JWT: signature verification failed" },
      { status: 401 }
    );
  }

  await ensureCapabilitiesSeeded();

  const defaultCapabilities =
    host.attestationTier === "attested"
      ? ATTESTED_HOST_POLICY_CAPABILITIES
      : DEFAULT_HOST_POLICY_CAPABILITIES;
  await ensureDefaultHostPolicies(
    host.id,
    defaultCapabilities,
    host.attestationTier === "attested" ? "attestation_default" : "default"
  );

  const publicKeyThumbprint = await computeJwkThumbprint(agentPublicKey);
  const [session] = await db
    .insert(agentSessions)
    .values({
      hostId: host.id,
      publicKey: agentPublicKey,
      publicKeyThumbprint,
      displayName: display.name,
      runtime: display.runtime,
      model: display.model,
      version: display.version,
      lastActiveAt: new Date(),
    })
    .returning({
      id: agentSessions.id,
      status: agentSessions.status,
    });

  if (!session) {
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }

  const activeGrants = await seedSessionGrantsFromHostPolicies(
    session.id,
    host.id
  );
  const pendingGrants = await createPendingSessionGrants(
    session.id,
    requestedCapabilities.filter(
      (capability: string) => !defaultCapabilities.includes(capability)
    )
  );

  return NextResponse.json(
    {
      sessionId: session.id,
      status: session.status,
      grants: [...activeGrants, ...pendingGrants],
    },
    { status: 201 }
  );
}
