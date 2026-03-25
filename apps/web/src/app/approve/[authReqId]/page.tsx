import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getAccountAssurance } from "@/lib/assurance/data";
import { getFreshSession } from "@/lib/auth/cached-session";
import { detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { buildStandaloneApprovalPath } from "@/lib/ciba/approval-path";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";

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

  const detected = await detectAuthMode(session.user.id);
  const { authMode } = detected;
  const { wallet } = detected;

  // Fetch agent claims — scoped to the current user to prevent cross-user leakage
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

  // Resolve registered agent identity if present
  let registeredAgent: {
    hostName: string;
    attestationProvider: string | null;
    attestationTier: string;
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
        registeredAgent={registeredAgent}
        userTier={assurance.tier}
        wallet={wallet}
      />
      <div className="mt-4 hidden text-center md:block">
        <Link
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          href={`/dashboard/agents/approve?auth_req_id=${encodeURIComponent(authReqId)}`}
        >
          View in dashboard
        </Link>
      </div>
    </div>
  );
}
