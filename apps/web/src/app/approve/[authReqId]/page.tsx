import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getCachedSession } from "@/lib/auth/cached-session";
import { detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { parseAgentClaims } from "@/lib/identity/agent-claims";

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ authReqId: string }>;
}) {
  const { authReqId } = await params;
  const session = await getCachedSession(await headers());

  if (!session?.user?.id) {
    redirect(
      `/sign-in?callbackURL=${encodeURIComponent(`/approve/${authReqId}`)}`
    );
  }

  const detected = await detectAuthMode(session.user.id);
  const { authMode } = detected;
  const { wallet } = detected;

  // Fetch agent claims — scoped to the current user to prevent cross-user leakage
  const cibaRow = await db
    .select({
      agentClaims: cibaRequests.agentClaims,
      clientId: cibaRequests.clientId,
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

  const agentClaims = cibaRow.agentClaims
    ? parseAgentClaims(cibaRow.agentClaims)
    : null;

  return (
    <div className="w-full max-w-md">
      <CibaApproveClient
        agentClaims={agentClaims}
        authMode={authMode}
        authReqId={authReqId}
        clientId={cibaRow.clientId}
        wallet={wallet}
      />
      <div className="mt-4 hidden text-center md:block">
        <Link
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          href={`/dashboard/ciba/approve?auth_req_id=${encodeURIComponent(authReqId)}`}
        >
          View in dashboard
        </Link>
      </div>
    </div>
  );
}
