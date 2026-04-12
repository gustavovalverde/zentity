import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { verifyAgentAttestation } from "@/lib/agents/agent-attestation";
import {
  AGENT_HOST_REGISTER_SCOPE,
  registerHostRequestSchema,
} from "@/lib/agents/agent-identity";
import { requireBootstrapAccessToken } from "@/lib/auth/api-auth";
import { computeJwkThumbprint } from "@/lib/auth/oidc/oauth-request";
import { db } from "@/lib/db/connection";
import { agentHosts } from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authResult = await requireBootstrapAccessToken(request, [
    AGENT_HOST_REGISTER_SCOPE,
  ]);
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = registerHostRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { principal } = authResult;
  const { publicKey, name } = parsed.data;
  const clientId = principal.clientId;

  const client = await db
    .select({ clientId: oauthClients.clientId })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
  if (!client) {
    return NextResponse.json(
      { error: "OAuth client not found" },
      { status: 404 }
    );
  }

  const attestationJwt = request.headers.get("OAuth-Client-Attestation");
  const attestationPopJwt = request.headers.get("OAuth-Client-Attestation-PoP");

  let attestationProvider: string | null = null;
  let attestationTier: "attested" | "self-declared" | "unverified" =
    "unverified";
  let attestationVerifiedAt: Date | null = null;

  if (attestationJwt) {
    const result = await verifyAgentAttestation(
      attestationJwt,
      attestationPopJwt ?? undefined,
      env.NEXT_PUBLIC_APP_URL
    );
    if (result.verified) {
      attestationProvider = result.provider ?? null;
      attestationTier = "attested";
      attestationVerifiedAt = result.verifiedAt
        ? new Date(result.verifiedAt * 1000)
        : new Date();
    }
  }

  const publicKeyThumbprint = await computeJwkThumbprint(publicKey);
  const existing = await db
    .select({
      clientId: agentHosts.clientId,
      id: agentHosts.id,
      userId: agentHosts.userId,
    })
    .from(agentHosts)
    .where(eq(agentHosts.publicKeyThumbprint, publicKeyThumbprint))
    .limit(1)
    .get();

  if (existing) {
    if (
      existing.userId !== principal.userId ||
      existing.clientId !== clientId
    ) {
      return NextResponse.json(
        { error: "Host key already belongs to a different user or client" },
        { status: 403 }
      );
    }

    await db
      .update(agentHosts)
      .set({
        publicKey,
        name,
        updatedAt: new Date(),
        ...(attestationTier === "unverified"
          ? {}
          : {
              attestationProvider,
              attestationTier,
              attestationVerifiedAt,
            }),
      })
      .where(eq(agentHosts.id, existing.id));

    return NextResponse.json({
      hostId: existing.id,
      created: false,
      attestation_tier: attestationTier,
    });
  }

  const [host] = await db
    .insert(agentHosts)
    .values({
      userId: principal.userId,
      clientId,
      publicKey,
      publicKeyThumbprint,
      name,
      attestationProvider,
      attestationTier,
      attestationVerifiedAt,
    })
    .returning({ id: agentHosts.id });

  if (!host) {
    return NextResponse.json(
      { error: "Failed to create host" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      hostId: host.id,
      created: true,
      attestation_tier: attestationTier,
    },
    { status: 201 }
  );
}
