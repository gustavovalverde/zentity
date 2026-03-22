import { eq } from "drizzle-orm";

import { env } from "@/env";
import { computePairwiseSub } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { agentSessions } from "@/lib/db/schema/agent";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

interface ClientPairwiseConfig {
  clientId: string;
  redirectUris: string | string[];
  subjectType: string | null;
}

async function getClientPairwiseConfig(
  clientId: string
): Promise<ClientPairwiseConfig | null> {
  const client = await db
    .select({
      clientId: oauthClients.clientId,
      redirectUris: oauthClients.redirectUris,
      subjectType: oauthClients.subjectType,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  return client ?? null;
}

export async function resolveAgentSubForClient(
  sessionId: string,
  clientId: string
): Promise<string> {
  const client = await getClientPairwiseConfig(clientId);
  if (!client) {
    return sessionId;
  }

  if (client.subjectType === "public") {
    return sessionId;
  }

  return computePairwiseSub(
    sessionId,
    client.redirectUris,
    env.PAIRWISE_SECRET
  );
}

export async function resolveAgentSessionIdFromPairwiseSub(
  pairwiseSub: string,
  clientId: string
): Promise<string | null> {
  const client = await getClientPairwiseConfig(clientId);
  if (!client) {
    return null;
  }

  if (client.subjectType === "public") {
    const session = await db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(eq(agentSessions.id, pairwiseSub))
      .limit(1)
      .get();
    return session?.id ?? null;
  }

  const sessions = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .all();
  for (const session of sessions) {
    const candidate = await computePairwiseSub(
      session.id,
      client.redirectUris,
      env.PAIRWISE_SECRET
    );
    if (candidate === pairwiseSub) {
      return session.id;
    }
  }

  return null;
}
