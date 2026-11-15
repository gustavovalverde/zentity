import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/env";
import { getAccountAssurance } from "@/lib/assurance/posture";
import { detectAuthMode, getCachedSession } from "@/lib/auth/session";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaApprovals, cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { AgentsClient } from "./_components/agents-client";

type AgentsTab = "connected" | "requests";

function parseDefaultTab(tab?: string): AgentsTab {
  if (tab === "connected") {
    return tab;
  }
  return "requests";
}

function resolveLocalMailpitUrl(): string | null {
  try {
    const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
    const isLocalHost =
      appUrl.hostname === "localhost" ||
      appUrl.hostname === "127.0.0.1" ||
      appUrl.hostname === "::1" ||
      appUrl.hostname === "[::1]";

    if (!isLocalHost) {
      return null;
    }

    return `http://${appUrl.hostname === "[::1]" ? "[::1]" : appUrl.hostname}:8025`;
  } catch {
    return null;
  }
}

export default async function AgentsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tab?: string }>;
}>) {
  const hdrs = await headers();
  const session = await getCachedSession(hdrs);
  if (!session) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const defaultTab = parseDefaultTab(params.tab);
  const cookies = hdrs.get("cookie");

  const mailpitUrl =
    process.env.NODE_ENV === "production" ? null : resolveLocalMailpitUrl();

  const userId = session.user.id;
  const [pending, decided, detected, assurance] = await Promise.all([
    db
      .select({
        acrValues: cibaRequests.acrValues,
        agentSessionId: cibaRequests.agentSessionId,
        attestationProvider: cibaRequests.attestationProvider,
        attestationTier: cibaRequests.attestationTier,
        authorizationDetails: cibaRequests.authorizationDetails,
        bindingMessage: cibaRequests.bindingMessage,
        clientId: cibaRequests.clientId,
        clientName: oauthClients.name,
        createdAt: cibaRequests.createdAt,
        displayName: cibaRequests.displayName,
        expiresAt: cibaRequests.expiresAt,
        hostName: agentHosts.name,
        id: cibaRequests.id,
        model: cibaRequests.model,
        runtime: cibaRequests.runtime,
        scope: cibaRequests.scope,
      })
      .from(cibaRequests)
      .leftJoin(oauthClients, eq(cibaRequests.clientId, oauthClients.clientId))
      .leftJoin(agentHosts, eq(cibaRequests.hostId, agentHosts.id))
      .where(
        and(eq(cibaRequests.userId, userId), eq(cibaRequests.status, "pending"))
      )
      .orderBy(desc(cibaRequests.createdAt))
      .limit(50),
    db
      .select({
        acrValues: cibaApprovals.acrValues,
        agentSessionId: cibaApprovals.agentSessionId,
        approvalChannel: cibaApprovals.approvalChannel,
        approvalMethod: cibaApprovals.approvalMethod,
        attestationProvider: cibaApprovals.attestationProvider,
        attestationTier: cibaApprovals.attestationTier,
        authorizationDetails: cibaApprovals.authorizationDetails,
        bindingMessage: cibaApprovals.bindingMessage,
        clientId: cibaApprovals.clientId,
        clientName: oauthClients.name,
        createdAt: cibaApprovals.requestedAt,
        decision: cibaApprovals.decision,
        displayName: agentSessions.displayName,
        expiresAt: cibaApprovals.expiresAt,
        hostName: agentHosts.name,
        id: cibaApprovals.requestId,
        model: agentSessions.model,
        runtime: agentSessions.runtime,
        scope: cibaApprovals.scope,
      })
      .from(cibaApprovals)
      .leftJoin(oauthClients, eq(cibaApprovals.clientId, oauthClients.clientId))
      .leftJoin(agentHosts, eq(cibaApprovals.hostId, agentHosts.id))
      .leftJoin(
        agentSessions,
        eq(cibaApprovals.agentSessionId, agentSessions.id)
      )
      .where(eq(cibaApprovals.userId, userId))
      .orderBy(desc(cibaApprovals.decidedAt))
      .limit(50),
    detectAuthMode(userId),
    getAccountAssurance(userId),
  ]);

  const requests = [
    ...pending.map((row) => ({
      ...row,
      approvalChannel: null,
      approvalMethod: null,
      status: "pending",
    })),
    ...decided.map(({ decision, ...row }) => ({ ...row, status: decision })),
  ];

  return (
    <AgentsClient
      authMode={detected.authMode}
      cookies={cookies}
      defaultTab={defaultTab}
      mailpitUrl={mailpitUrl}
      requests={requests}
      userTier={assurance.tier}
      wallet={detected.wallet}
    />
  );
}
