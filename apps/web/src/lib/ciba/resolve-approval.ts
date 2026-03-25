import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export interface AgentIdentitySummary {
  model?: string;
  name: string;
  runtime?: string;
}

export interface RegisteredAgentInfo {
  attestationProvider: string | null;
  attestationTier: string;
  hostName: string;
  sessionId: string;
}

export interface AuthorizationDetail {
  amount?: { currency?: string; value?: string };
  item?: string;
  merchant?: string;
  type?: string;
  [key: string]: unknown;
}

export interface CibaRequestDetails {
  acr_values?: string;
  auth_req_id: string;
  authorization_details?: AuthorizationDetail[];
  binding_message?: string;
  client_id?: string;
  client_name?: string;
  expires_at: string;
  scope: string;
  status: string;
}

interface CibaApprovalData {
  agentIdentity: AgentIdentitySummary | null;
  registeredAgent: RegisteredAgentInfo | null;
  request: CibaRequestDetails;
}

/**
 * Resolves all CIBA approval data needed to render the approval UI.
 * Returns null when the request doesn't exist or doesn't belong to the user.
 */
export async function resolveCibaApprovalData(
  authReqId: string,
  userId: string
): Promise<CibaApprovalData | null> {
  const row = await db
    .select({
      acrValues: cibaRequests.acrValues,
      agentSessionId: cibaRequests.agentSessionId,
      authReqId: cibaRequests.authReqId,
      authorizationDetails: cibaRequests.authorizationDetails,
      bindingMessage: cibaRequests.bindingMessage,
      clientId: cibaRequests.clientId,
      clientName: oauthClients.name,
      displayName: cibaRequests.displayName,
      expiresAt: cibaRequests.expiresAt,
      model: cibaRequests.model,
      runtime: cibaRequests.runtime,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .leftJoin(oauthClients, eq(cibaRequests.clientId, oauthClients.clientId))
    .where(
      and(
        eq(cibaRequests.authReqId, authReqId),
        eq(cibaRequests.userId, userId)
      )
    )
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  const agentIdentity: AgentIdentitySummary | null =
    row.displayName == null
      ? null
      : {
          name: row.displayName,
          ...(row.model ? { model: row.model } : {}),
          ...(row.runtime ? { runtime: row.runtime } : {}),
        };

  let registeredAgent: RegisteredAgentInfo | null = null;
  if (row.agentSessionId) {
    const agentRow = await db
      .select({
        attestationProvider: agentHosts.attestationProvider,
        attestationTier: agentHosts.attestationTier,
        hostName: agentHosts.name,
        sessionId: agentSessions.id,
      })
      .from(agentSessions)
      .innerJoin(agentHosts, eq(agentSessions.hostId, agentHosts.id))
      .where(eq(agentSessions.id, row.agentSessionId))
      .limit(1)
      .get();

    if (agentRow) {
      registeredAgent = {
        attestationProvider: agentRow.attestationProvider,
        attestationTier: agentRow.attestationTier,
        hostName: agentRow.hostName,
        sessionId: agentRow.sessionId,
      };
    }
  }

  let authorizationDetails: AuthorizationDetail[] | undefined;
  if (row.authorizationDetails) {
    try {
      const parsed: unknown = JSON.parse(row.authorizationDetails);
      if (Array.isArray(parsed)) {
        authorizationDetails = parsed as AuthorizationDetail[];
      }
    } catch {
      // Malformed JSON — leave as undefined
    }
  }

  const request: CibaRequestDetails = {
    auth_req_id: row.authReqId,
    expires_at: row.expiresAt.toISOString(),
    scope: row.scope,
    status: row.status,
    ...(row.acrValues ? { acr_values: row.acrValues } : {}),
    ...(authorizationDetails
      ? { authorization_details: authorizationDetails }
      : {}),
    ...(row.bindingMessage ? { binding_message: row.bindingMessage } : {}),
    ...(row.clientId ? { client_id: row.clientId } : {}),
    ...(row.clientName ? { client_name: row.clientName } : {}),
  };

  return { agentIdentity, registeredAgent, request };
}
