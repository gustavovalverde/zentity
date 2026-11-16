import { eq } from "drizzle-orm";

import { env } from "@/env";
import {
  clientSector,
  computePairwiseSub,
  type SectorClient,
} from "@/lib/auth/oidc/pairwise";
import { upsertPairwiseSubjectIndex } from "@/lib/auth/oidc/pairwise-subject-index";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

interface ClientPairwiseConfig extends SectorClient {
  clientId: string;
  metadata: string | null;
}

type AgentSubjectType = "pairwise" | "public";

function getAgentSubjectType(client: ClientPairwiseConfig): AgentSubjectType {
  if (client.metadata) {
    try {
      const metadata = JSON.parse(client.metadata) as Record<string, unknown>;
      const configured = metadata.agent_subject_type;
      if (configured === "pairwise" || configured === "public") {
        return configured;
      }
    } catch {
      // Malformed metadata falls through to the privacy-preserving default.
    }
  }

  return "pairwise";
}

async function getClientPairwiseConfig(
  clientId: string
): Promise<ClientPairwiseConfig | null> {
  const client = await db
    .select({
      clientId: oauthClients.clientId,
      metadata: oauthClients.metadata,
      redirectUris: oauthClients.redirectUris,
      sectorIdentifier: oauthClients.sectorIdentifier,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  return client
    ? {
        ...client,
        redirectUris: parseStoredStringArray(client.redirectUris),
      }
    : null;
}

export async function resolveAgentSubForClient(
  sessionId: string,
  clientId: string
): Promise<string> {
  const client = await getClientPairwiseConfig(clientId);
  if (!client) {
    return sessionId;
  }

  if (getAgentSubjectType(client) === "public") {
    return sessionId;
  }

  const sector = clientSector(client);
  const sub = await computePairwiseSub(sessionId, sector, env.PAIRWISE_SECRET);
  await upsertPairwiseSubjectIndex({
    sector,
    sub,
    subjectId: sessionId,
    subjectType: "agent_session",
  });
  return sub;
}
