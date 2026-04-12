"use client";

import type { AuthMode } from "@/lib/auth/detect-auth-mode";
import type {
  AgentIdentitySummary,
  AuthorizationDetail,
  CibaRequestDetails,
  RegisteredAgentInfo,
} from "@/lib/ciba/resolve-approval";

import { Bot, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { CibaApproveClient } from "@/components/ciba-approve-client";
import { PageHeader } from "@/components/page-header";
import { Web3Provider } from "@/components/providers/web3-provider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ConnectedTab } from "./connected-tab";
import { CibaLiveUpdater } from "./live-updater";
import { RequestsTab } from "./requests-tab";

interface CibaRequestRow {
  acrValues: string | null;
  agentSessionId: string | null;
  approvalMethod: string | null;
  attestationProvider: string | null;
  attestationTier: string | null;
  authorizationDetails: string | null;
  authReqId: string;
  bindingMessage: string | null;
  clientId: string;
  clientName: string | null;
  createdAt: Date;
  displayName: string | null;
  expiresAt: Date;
  hostName: string | null;
  model: string | null;
  runtime: string | null;
  scope: string;
  status: string;
}

type AgentsTab = "connected" | "requests";

function deriveAgentIdentity(row: CibaRequestRow): AgentIdentitySummary | null {
  if (row.displayName == null) {
    return null;
  }
  return {
    name: row.displayName,
    ...(row.model ? { model: row.model } : {}),
    ...(row.runtime ? { runtime: row.runtime } : {}),
  };
}

function deriveRegisteredAgent(
  row: CibaRequestRow
): RegisteredAgentInfo | null {
  if (!(row.agentSessionId && row.hostName)) {
    return null;
  }
  return {
    attestationProvider: row.attestationProvider,
    attestationTier: row.attestationTier ?? "unverified",
    hostName: row.hostName,
    sessionId: row.agentSessionId,
  };
}

function deriveRequestDetails(row: CibaRequestRow): CibaRequestDetails {
  let authorizationDetails: AuthorizationDetail[] | undefined;
  if (row.authorizationDetails) {
    try {
      const parsed: unknown = JSON.parse(row.authorizationDetails);
      if (Array.isArray(parsed)) {
        authorizationDetails = parsed as AuthorizationDetail[];
      }
    } catch {
      // Malformed JSON — leave as undefined
    }
  }

  return {
    auth_req_id: row.authReqId,
    expires_at: row.expiresAt.toISOString(),
    scope: row.scope,
    status: row.status,
    ...(row.acrValues ? { acr_values: row.acrValues } : {}),
    ...(authorizationDetails
      ? { authorization_details: authorizationDetails }
      : {}),
    ...(row.bindingMessage ? { binding_message: row.bindingMessage } : {}),
    ...(row.clientId ? { client_id: row.clientId } : {}),
    ...(row.clientName ? { client_name: row.clientName } : {}),
  };
}

export function AgentsClient({
  authMode,
  cookies,
  defaultTab,
  mailpitUrl,
  requests,
  userTier,
  wallet,
}: Readonly<{
  authMode: AuthMode;
  cookies: string | null;
  defaultTab: AgentsTab;
  mailpitUrl: string | null;
  requests: CibaRequestRow[];
  userTier: 0 | 1 | 2 | 3;
  wallet: { address: string; chainId: number } | null;
}>) {
  const router = useRouter();
  const [selectedAuthReqId, setSelectedAuthReqId] = useState<string | null>(
    null
  );

  const selectedRequest = selectedAuthReqId
    ? requests.find((r) => r.authReqId === selectedAuthReqId)
    : undefined;

  const handleSheetClose = useCallback(() => {
    setSelectedAuthReqId(null);
    router.refresh();
  }, [router]);

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
          <RequestsTab
            mailpitUrl={mailpitUrl}
            onSelect={setSelectedAuthReqId}
            requests={requests}
          />
        </TabsContent>

        <TabsContent className="mt-6 space-y-6" value="connected">
          <ConnectedTab />
        </TabsContent>
      </Tabs>

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            handleSheetClose();
          }
        }}
        open={selectedAuthReqId != null}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>Authorization Request</SheetTitle>
          </SheetHeader>
          {selectedRequest && (
            <Web3Provider cookies={cookies}>
              <CibaApproveClient
                agentIdentity={deriveAgentIdentity(selectedRequest)}
                authMode={authMode}
                authReqId={selectedAuthReqId}
                initialRequest={deriveRequestDetails(selectedRequest)}
                onClose={handleSheetClose}
                registeredAgent={deriveRegisteredAgent(selectedRequest)}
                userTier={userTier}
                wallet={wallet}
              />
            </Web3Provider>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
