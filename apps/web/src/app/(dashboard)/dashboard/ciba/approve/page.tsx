import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getAccountAssurance } from "@/lib/assurance/data";
import { getCachedSession } from "@/lib/auth/cached-session";
import { type AuthMode, detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";

export default async function CibaApprovePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getCachedSession(await headers());
  let authMode: AuthMode = null;
  let wallet: { address: string; chainId: number } | null = null;
  let userTier: 0 | 1 | 2 | 3 = 0;

  if (!session?.user?.id) {
    const params = await searchParams;
    const authReqId =
      typeof params.auth_req_id === "string" ? params.auth_req_id : null;
    return (
      <CibaApproveClient
        authMode={null}
        authReqId={authReqId}
        userTier={0}
        wallet={null}
      />
    );
  }

  const [detected, assurance] = await Promise.all([
    detectAuthMode(session.user.id),
    getAccountAssurance(session.user.id),
  ]);
  authMode = detected.authMode;
  wallet = detected.wallet;
  userTier = assurance.tier;

  const params = await searchParams;
  const authReqId =
    typeof params.auth_req_id === "string" ? params.auth_req_id : null;

  // Resolve agent identity (matching standalone /approve/[authReqId] page)
  let agentIdentity: { name: string; model?: string; runtime?: string } | null =
    null;
  let registeredAgent: {
    hostName: string;
    attestationProvider: string | null;
    attestationTier: string;
    sessionId: string;
  } | null = null;

  if (authReqId) {
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

    if (cibaRow) {
      agentIdentity =
        cibaRow.displayName == null
          ? null
          : {
              name: cibaRow.displayName,
              ...(cibaRow.model ? { model: cibaRow.model } : {}),
              ...(cibaRow.runtime ? { runtime: cibaRow.runtime } : {}),
            };

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
    }
  }

  return (
    <CibaApproveClient
      agentIdentity={agentIdentity}
      authMode={authMode}
      authReqId={authReqId}
      registeredAgent={registeredAgent}
      userTier={userTier}
      wallet={wallet}
    />
  );
}
