import { eq } from "drizzle-orm";

import {
  buildAgentAssertionReplayKey,
  cleanupExpiredAgentAssertionJtis,
  sha256Hex,
  verifyAgentAssertion,
} from "@/lib/ciba/agent-jwt";
import {
  type AuthorizationDetail,
  deriveCapabilityName,
  resolveCapabilityApprovalStrength,
} from "@/lib/ciba/grant-evaluation";
import { resolveAgentSubForClient } from "@/lib/ciba/pairwise-agent";
import { db } from "@/lib/db/connection";
import {
  agentHosts,
  agentSessions,
  usedAgentAssertionJtis,
} from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";

interface BoundAgentAssertion {
  agentName: string;
  approvalStrength?: string | undefined;
  capabilityName: string | null;
  registeredAgent: {
    attestationProvider?: string | null;
    attestationTier?: string | null;
    model?: string | null;
    name: string;
    runtime?: string | null;
    version?: string | null;
  };
  sessionId: string;
}

interface BindAgentAssertionParams {
  assertionJwt: string;
  authorizationDetails: AuthorizationDetail[];
  authReqId: string;
  scope: string;
}

export async function bindAgentAssertionToCibaRequest(
  params: BindAgentAssertionParams
): Promise<BoundAgentAssertion | null> {
  const cibaRow = await db
    .select({
      bindingMessage: cibaRequests.bindingMessage,
      clientId: cibaRequests.clientId,
      userId: cibaRequests.userId,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, params.authReqId))
    .limit(1)
    .get();
  if (!cibaRow?.bindingMessage) {
    return null;
  }

  const assertion = await verifyAgentAssertion(params.assertionJwt);
  if (!(assertion?.taskDescriptionHash && assertion.hostId)) {
    return null;
  }

  const expectedTaskHash = await sha256Hex(cibaRow.bindingMessage);
  if (expectedTaskHash !== assertion.taskDescriptionHash) {
    return null;
  }

  const session = await db
    .select({
      displayName: agentSessions.displayName,
      hostId: agentSessions.hostId,
      id: agentSessions.id,
      model: agentSessions.model,
      runtime: agentSessions.runtime,
      version: agentSessions.version,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, assertion.sessionId))
    .limit(1)
    .get();
  if (!session || session.hostId !== assertion.hostId) {
    return null;
  }

  const host = await db
    .select({
      attestationProvider: agentHosts.attestationProvider,
      attestationTier: agentHosts.attestationTier,
      clientId: agentHosts.clientId,
      id: agentHosts.id,
      userId: agentHosts.userId,
    })
    .from(agentHosts)
    .where(eq(agentHosts.id, session.hostId))
    .limit(1)
    .get();
  if (
    !host ||
    host.id !== assertion.hostId ||
    host.userId !== cibaRow.userId ||
    host.clientId !== cibaRow.clientId
  ) {
    return null;
  }

  const capabilityName = deriveCapabilityName(
    params.authorizationDetails,
    params.scope
  );
  const approvalStrength =
    await resolveCapabilityApprovalStrength(capabilityName);
  const pairwiseActSub = await resolveAgentSubForClient(
    session.id,
    cibaRow.clientId
  );

  await cleanupExpiredAgentAssertionJtis();

  let bound = false;
  await db.transaction(async (tx) => {
    const replayInsert = await tx
      .insert(usedAgentAssertionJtis)
      .values({
        id: buildAgentAssertionReplayKey(assertion.sessionId, assertion.jti),
        sessionId: assertion.sessionId,
        jti: assertion.jti,
        expiresAt: new Date(assertion.exp * 1000),
      })
      .onConflictDoNothing()
      .run();
    if (replayInsert.rowsAffected === 0) {
      return;
    }

    await tx
      .update(cibaRequests)
      .set({
        agentSessionId: session.id,
        hostId: session.hostId,
        displayName: session.displayName,
        runtime: session.runtime,
        model: session.model,
        version: session.version,
        taskId: assertion.taskId,
        taskHash: assertion.taskDescriptionHash,
        assertionVerified: true,
        pairwiseActSub,
        approvedCapabilityName: capabilityName,
        approvalStrength,
        attestationProvider: host.attestationProvider ?? null,
        attestationTier: host.attestationTier ?? "unverified",
      })
      .where(eq(cibaRequests.authReqId, params.authReqId));

    await tx
      .update(agentSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(agentSessions.id, session.id));

    bound = true;
  });

  if (!bound) {
    return null;
  }

  return {
    sessionId: session.id,
    agentName: session.displayName,
    capabilityName,
    approvalStrength,
    registeredAgent: {
      name: session.displayName,
      model: session.model,
      runtime: session.runtime,
      version: session.version,
      attestationProvider: host.attestationProvider ?? null,
      attestationTier: host.attestationTier ?? "unverified",
    },
  };
}
