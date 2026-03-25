import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getAccountAssurance } from "@/lib/assurance/data";
import { getFreshSession } from "@/lib/auth/cached-session";
import { detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";

interface InteractionCopy {
  deniedDescription?: string;
  description?: string;
  requestedProfileFields?: string[];
  successDescription?: string;
  title?: string;
}

function buildInteractionCopy(input: {
  fields: string[];
  tool: string;
}): InteractionCopy {
  if (input.tool === "my_profile") {
    return {
      title: "Profile Access Request",
      description:
        "An application is requesting access to the selected profile fields. Vault-protected fields require an unlock before they can be released.",
      successDescription:
        "You approved the profile disclosure request. The requesting agent can now continue.",
      deniedDescription: "You denied the profile disclosure request.",
      requestedProfileFields: input.fields,
    };
  }

  if (input.tool === "purchase") {
    return {
      title: "Purchase Authorization",
      description:
        "An application is requesting approval to complete a purchase on your behalf.",
      successDescription:
        "You approved the purchase request. The requesting agent can now continue.",
      deniedDescription: "You denied the purchase request.",
    };
  }

  return {
    title: "Authorization Request",
  };
}

export default async function McpInteractivePage({
  params,
  searchParams,
}: {
  params: Promise<{ interactionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { interactionId } = await params;
  const resolvedSearchParams = await searchParams;
  const authReqId = resolvedSearchParams.authReqId;
  const tool = resolvedSearchParams.tool;
  const fieldsParam = resolvedSearchParams.fields;
  const fields =
    typeof fieldsParam === "string"
      ? fieldsParam.split(",").filter(Boolean)
      : [];

  if (typeof authReqId !== "string" || typeof tool !== "string") {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Invalid interaction link</p>
        </div>
      </div>
    );
  }

  const callbackPath = `/mcp/interactive/${encodeURIComponent(interactionId)}`;
  const callbackQuery = new URLSearchParams();
  callbackQuery.set("authReqId", authReqId);
  callbackQuery.set("tool", tool);
  if (fields.length > 0) {
    callbackQuery.set("fields", fields.join(","));
  }

  const session = await getFreshSession(await headers());

  if (!session?.user?.id) {
    redirect(
      `/sign-in?callbackURL=${encodeURIComponent(
        `${callbackPath}?${callbackQuery.toString()}`
      )}`
    );
  }

  const sessionAuthContextId =
    (session.session as { authContextId?: string | null }).authContextId ??
    null;

  if (!sessionAuthContextId) {
    redirect(
      `/sign-in?callbackURL=${encodeURIComponent(
        `${callbackPath}?${callbackQuery.toString()}`
      )}`
    );
  }

  const detected = await detectAuthMode(session.user.id);
  const { authMode } = detected;
  const { wallet } = detected;

  const cibaRow = await db
    .select({
      agentSessionId: cibaRequests.agentSessionId,
      displayName: cibaRequests.displayName,
      model: cibaRequests.model,
      runtime: cibaRequests.runtime,
    })
    .from(cibaRequests)
    .where(
      and(
        eq(cibaRequests.authReqId, authReqId),
        eq(cibaRequests.userId, session.user.id)
      )
    )
    .limit(1)
    .get();

  if (!cibaRow) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Request not found</p>
        </div>
      </div>
    );
  }

  const agentIdentity =
    cibaRow.displayName == null
      ? null
      : {
          name: cibaRow.displayName,
          ...(cibaRow.model ? { model: cibaRow.model } : {}),
          ...(cibaRow.runtime ? { runtime: cibaRow.runtime } : {}),
        };

  let registeredAgent: {
    attestationProvider: string | null;
    attestationTier: string;
    hostName: string;
    sessionId: string;
  } | null = null;

  if (cibaRow.agentSessionId) {
    const agentRow = await db
      .select({
        sessionId: agentSessions.id,
        hostName: agentHosts.name,
        attestationProvider: agentHosts.attestationProvider,
        attestationTier: agentHosts.attestationTier,
      })
      .from(agentSessions)
      .innerJoin(agentHosts, eq(agentSessions.hostId, agentHosts.id))
      .where(eq(agentSessions.id, cibaRow.agentSessionId))
      .limit(1)
      .get();

    if (agentRow) {
      registeredAgent = {
        hostName: agentRow.hostName,
        attestationProvider: agentRow.attestationProvider,
        attestationTier: agentRow.attestationTier,
        sessionId: agentRow.sessionId,
      };
    }
  }

  const assurance = await getAccountAssurance(session.user.id);

  return (
    <div className="w-full max-w-md">
      <CibaApproveClient
        agentIdentity={agentIdentity}
        authMode={authMode}
        authReqId={authReqId}
        interactionCopy={buildInteractionCopy({ tool, fields })}
        registeredAgent={registeredAgent}
        userTier={assurance.tier}
        wallet={wallet}
      />
    </div>
  );
}
