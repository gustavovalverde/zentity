import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/env";
import { getAccountAssurance } from "@/lib/assurance/data";
import { detectAuthMode, getCachedSession } from "@/lib/auth/session";
import { db } from "@/lib/db/connection";
import { agentHosts } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
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

  const [requests, detected, assurance] = await Promise.all([
    db
      .select({
        acrValues: cibaRequests.acrValues,
        agentSessionId: cibaRequests.agentSessionId,
        approvalMethod: cibaRequests.approvalMethod,
        attestationProvider: cibaRequests.attestationProvider,
        attestationTier: cibaRequests.attestationTier,
        authReqId: cibaRequests.authReqId,
        authorizationDetails: cibaRequests.authorizationDetails,
        bindingMessage: cibaRequests.bindingMessage,
        clientId: cibaRequests.clientId,
        clientName: oauthClients.name,
        createdAt: cibaRequests.createdAt,
        displayName: cibaRequests.displayName,
        expiresAt: cibaRequests.expiresAt,
        hostName: agentHosts.name,
        model: cibaRequests.model,
        runtime: cibaRequests.runtime,
        scope: cibaRequests.scope,
        status: cibaRequests.status,
      })
      .from(cibaRequests)
      .leftJoin(oauthClients, eq(cibaRequests.clientId, oauthClients.clientId))
      .leftJoin(agentHosts, eq(cibaRequests.hostId, agentHosts.id))
      .where(eq(cibaRequests.userId, session.user.id))
      .orderBy(desc(cibaRequests.createdAt))
      .limit(50),
    detectAuthMode(session.user.id),
    getAccountAssurance(session.user.id),
  ]);

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
