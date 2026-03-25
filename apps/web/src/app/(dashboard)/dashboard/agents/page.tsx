import { desc, eq } from "drizzle-orm";
import { Bot, MessageSquare } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layouts/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { env } from "@/env";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

import { ConnectedTab } from "./_components/connected-tab";
import { CibaLiveUpdater } from "./_components/live-updater";
import { RequestsTab } from "./_components/requests-tab";

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
  const session = await getCachedSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const defaultTab = parseDefaultTab(params.tab);

  const mailpitUrl =
    process.env.NODE_ENV === "production" ? null : resolveLocalMailpitUrl();

  const requests = await db
    .select({
      approvalMethod: cibaRequests.approvalMethod,
      attestationTier: cibaRequests.attestationTier,
      authReqId: cibaRequests.authReqId,
      authorizationDetails: cibaRequests.authorizationDetails,
      bindingMessage: cibaRequests.bindingMessage,
      clientName: oauthClients.name,
      createdAt: cibaRequests.createdAt,
      displayName: cibaRequests.displayName,
      expiresAt: cibaRequests.expiresAt,
      model: cibaRequests.model,
      runtime: cibaRequests.runtime,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .leftJoin(oauthClients, eq(cibaRequests.clientId, oauthClients.clientId))
    .where(eq(cibaRequests.userId, session.user.id))
    .orderBy(desc(cibaRequests.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <CibaLiveUpdater />
      <PageHeader
        description="Manage agent access and review authorization requests."
        title="Agents"
      />

      <Tabs defaultValue={defaultTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger className="gap-1.5" value="requests">
            <MessageSquare className="size-4" />
            <span className="hidden sm:inline">Requests</span>
          </TabsTrigger>
          <TabsTrigger className="gap-1.5" value="connected">
            <Bot className="size-4" />
            <span className="hidden sm:inline">Connected</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-6 space-y-6" value="requests">
          <RequestsTab mailpitUrl={mailpitUrl} requests={requests} />
        </TabsContent>

        <TabsContent className="mt-6 space-y-6" value="connected">
          <ConnectedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
