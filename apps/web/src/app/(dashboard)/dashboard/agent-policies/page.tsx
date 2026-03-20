import { headers } from "next/headers";

import { PageHeader } from "@/components/layouts/page-header";
import { getCachedSession } from "@/lib/auth/cached-session";

import { AgentPoliciesClient } from "./_components/agent-policies-client";

export default async function AgentPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  if (!session) {
    return null;
  }

  const params = await searchParams;
  const prefill =
    params.create === "true"
      ? {
          create: true as const,
          clientId:
            typeof params.clientId === "string" ? params.clientId : undefined,
          type: typeof params.type === "string" ? params.type : undefined,
          maxAmount:
            typeof params.maxAmount === "string" ? params.maxAmount : undefined,
          currency:
            typeof params.currency === "string" ? params.currency : undefined,
          scopes: typeof params.scopes === "string" ? params.scopes : undefined,
        }
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        description="Configure auto-approval rules for agent authorization requests."
        title="Agent Policies"
      />

      <AgentPoliciesClient prefill={prefill} />
    </div>
  );
}
