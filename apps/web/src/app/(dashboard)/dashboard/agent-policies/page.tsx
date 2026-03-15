import { headers } from "next/headers";

import { getCachedSession } from "@/lib/auth/cached-session";

import { AgentPoliciesClient } from "./_components/agent-policies-client";

export default async function AgentPoliciesPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  if (!session) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Agent Policies</h1>
        <p className="text-muted-foreground">
          Configure auto-approval rules for agent authorization requests.
        </p>
      </div>

      <AgentPoliciesClient />
    </div>
  );
}
