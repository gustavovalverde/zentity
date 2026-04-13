import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AgentApprovalView } from "@/components/agent-approval-view";
import {
  buildStandaloneApprovalPath,
  resolveCibaApprovalData,
} from "@/lib/agents/resolve-approval";
import { getAccountAssurance } from "@/lib/assurance/data";
import { detectAuthMode, getFreshSession } from "@/lib/auth/session";

export default async function ApprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ authReqId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { authReqId } = await params;
  const callbackPath = buildStandaloneApprovalPath(
    authReqId,
    await searchParams
  );
  const session = await getFreshSession(await headers());

  if (!session?.user?.id) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const [detected, assurance, approval] = await Promise.all([
    detectAuthMode(session.user.id),
    getAccountAssurance(session.user.id),
    resolveCibaApprovalData(authReqId, session.user.id),
  ]);

  if (!approval) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Request not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <AgentApprovalView
        agentIdentity={approval.agentIdentity}
        authMode={detected.authMode}
        authReqId={authReqId}
        initialRequest={approval.request}
        registeredAgent={approval.registeredAgent}
        userTier={assurance.tier}
        wallet={detected.wallet}
      />
      <div className="mt-4 hidden text-center md:block">
        <Link
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          href="/dashboard/agents"
        >
          View in dashboard
        </Link>
      </div>
    </div>
  );
}
