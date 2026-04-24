import { decodeEd25519DidKeyToJwk } from "@zentity/sdk/protocol";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/env";
import { verifyAgentAttestation } from "@/lib/agents/host-attestation";
import {
  AGENT_HOST_REGISTER_SCOPE,
  registerHostRequestSchema,
} from "@/lib/agents/session";
import { computeJwkThumbprint } from "@/lib/auth/oidc/oauth-request";
import { requireBootstrapAccessToken } from "@/lib/auth/resource-auth";
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
      { error: "Invalid request body", details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }

  const { principal } = authResult;
  const { did, name } = parsed.data;
  const clientId = principal.clientId;
  let publicKeyJwkJson: string;

  try {
    publicKeyJwkJson = JSON.stringify(decodeEd25519DidKeyToJwk(did));
  } catch {
    return NextResponse.json(
      { error: "invalid_did_key_format" },
      { status: 400 }
    );
  }

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
    attestationTier = "self-declared";
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

  const publicKeyThumbprint = await computeJwkThumbprint(publicKeyJwkJson);
  const existing = await db
    .select({
      attestationProvider: agentHosts.attestationProvider,
      attestationTier: agentHosts.attestationTier,
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

    const nextAttestationTier = attestationJwt
      ? attestationTier
      : (existing.attestationTier as
          | "attested"
          | "self-declared"
          | "unverified");
    const nextAttestationProvider = attestationJwt
      ? attestationProvider
      : existing.attestationProvider;

    await db
      .update(agentHosts)
      .set({
        publicKey: publicKeyJwkJson,
        name,
        updatedAt: new Date(),
        attestationProvider: nextAttestationProvider,
        attestationTier: nextAttestationTier,
        ...(attestationJwt ? { attestationVerifiedAt } : {}),
      })
      .where(eq(agentHosts.id, existing.id));

    return NextResponse.json({
      hostId: existing.id,
      did,
      created: false,
      attestation_tier: nextAttestationTier,
    });
  }

  const [host] = await db
    .insert(agentHosts)
    .values({
      userId: principal.userId,
      clientId,
      publicKey: publicKeyJwkJson,
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
      did,
      created: true,
      attestation_tier: attestationTier,
    },
    { status: 201 }
  );
}
