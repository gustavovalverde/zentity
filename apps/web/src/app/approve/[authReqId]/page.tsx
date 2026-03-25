import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getAccountAssurance } from "@/lib/assurance/data";
import { getFreshSession } from "@/lib/auth/cached-session";
import { detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { buildStandaloneApprovalPath } from "@/lib/ciba/approval-path";
import { resolveCibaApprovalData } from "@/lib/ciba/resolve-approval";

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
      <CibaApproveClient
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
