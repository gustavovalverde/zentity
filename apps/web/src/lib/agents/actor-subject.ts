import { pairwiseValue } from "@/lib/auth/oidc/pairwise";

/** The client fields that decide how a token names its agent actor. */
export interface AgentActorClient {
  clientId: string;
  metadata?: Record<string, unknown> | string | null | undefined;
}

type AgentSubjectType = "pairwise" | "public";

function parseMetadata(
  metadata: AgentActorClient["metadata"]
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }
  if (typeof metadata !== "string") {
    return metadata;
  }
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The client's `agent_subject_type`, which only an administrator sets.
 * Absent or malformed metadata falls through to the pairwise default.
 */
function agentSubjectType(client: AgentActorClient): AgentSubjectType {
  const configured = parseMetadata(client.metadata)?.agent_subject_type;
  return configured === "public" ? "public" : "pairwise";
}

/**
 * The `act.sub` of a token for a verified agent session: pairwise in the
 * token's own sector, so each audience sees its own value, or the session id
 * for a client whose `agent_subject_type` is `public`. Nothing maps the value
 * back to the session; the token's record does.
 */
export async function resolveAgentSub(input: {
  client: AgentActorClient;
  sector: string;
  sessionId: string;
}): Promise<string> {
  return agentSubjectType(input.client) === "public"
    ? input.sessionId
    : await pairwiseValue(input.sector, input.sessionId);
}
