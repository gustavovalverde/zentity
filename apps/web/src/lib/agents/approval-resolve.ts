import type {
  ApprovalCeremony,
  ApprovalPolicy,
  AuthorizationDetail,
  ScopeLabel,
} from "./capability";

import {
  IDENTITY_STRENGTHS,
  type IdentityStrength,
  meetsIdentityStrength,
  X402_PURCHASE_TYPE,
  X402PurchaseAuthorizationSchema,
} from "@zentity/sdk/protocol";
import { and, eq } from "drizzle-orm";

import { hasPasskey } from "@/lib/auth/passkey/step-up";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { agentHosts, agentSessions } from "@/lib/db/schema/agent";
import { cibaRequests } from "@/lib/db/schema/ciba";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  currentIdentityStrength,
  getVerificationReadModel,
} from "@/lib/identity/verification/read-model";

import {
  approvalPolicy,
  normalizeAuthorizationDetails,
  requiredCeremony,
} from "./capability";

export type { AuthorizationDetail } from "./capability";

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

/** What approving the request takes from this user, for the approval page. */
export interface ApprovalRequirementDetails {
  /** The ceremony an approval needs from this user. */
  approval_requirement: ApprovalCeremony;
  /** Present only for a request with an `x402_purchase` entry. */
  identity_strength?: IdentityStrengthRequirement;
  /** Whether a notification may not approve it. */
  page_only: boolean;
  passkey_available: boolean;
  /** Server text for every requested scope other than `openid`. */
  scope_labels: ScopeLabel[];
}

/** Whether the user's identity strength meets an x402 merchant's minimum. */
export interface IdentityStrengthRequirement {
  required: IdentityStrength;
  satisfied: boolean;
}

const STRONGEST_IDENTITY = IDENTITY_STRENGTHS.at(-1) as IdentityStrength;

/**
 * The identity strength an `x402_purchase` entry requires, or null for a
 * request without one. An entry that no longer parses requires the strongest
 * evidence, so it can never be approved.
 */
function requiredIdentityStrength(
  authorizationDetails: unknown
): IdentityStrength | null {
  const entry = normalizeAuthorizationDetails(authorizationDetails).find(
    (detail) => detail.type === X402_PURCHASE_TYPE
  );
  if (!entry) {
    return null;
  }
  const parsed = X402PurchaseAuthorizationSchema.safeParse(entry);
  return parsed.success
    ? parsed.data.min_identity_strength
    : STRONGEST_IDENTITY;
}

/**
 * Compares the user's current identity strength with what the request's
 * `x402_purchase` entry requires. Null when the request has no such entry.
 */
export async function identityStrengthRequirement(
  userId: string,
  authorizationDetails: unknown
): Promise<IdentityStrengthRequirement | null> {
  const required = requiredIdentityStrength(authorizationDetails);
  if (!required) {
    return null;
  }
  const model = await getVerificationReadModel(userId);
  return {
    required,
    satisfied: meetsIdentityStrength(currentIdentityStrength(model), required),
  };
}

export function describeApprovalRequirement(
  policy: ApprovalPolicy,
  userHasPasskey: boolean
): ApprovalRequirementDetails {
  return {
    approval_requirement: requiredCeremony(policy, {
      hasPasskey: userHasPasskey,
    }),
    page_only: policy.pageOnly,
    passkey_available: userHasPasskey,
    scope_labels: policy.labels,
  };
}

export interface CibaRequestDetails
  extends Partial<ApprovalRequirementDetails> {
  acr_values?: string;
  authorization_details?: AuthorizationDetail[];
  binding_message?: string;
  client_id?: string;
  client_name?: string;
  expires_at: string;
  request_id: string;
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
  requestId: string,
  userId: string
): Promise<CibaApprovalData | null> {
  const row = await db
    .select({
      acrValues: cibaRequests.acrValues,
      agentSessionId: cibaRequests.agentSessionId,
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
    .where(and(eq(cibaRequests.id, requestId), eq(cibaRequests.userId, userId)))
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

  const acrValues = parseStoredStringArray(row.acrValues).join(" ");
  const requirement = describeApprovalRequirement(
    approvalPolicy({
      scope: row.scope,
      authorizationDetails: row.authorizationDetails,
    }),
    await hasPasskey(userId)
  );
  const identityStrength = await identityStrengthRequirement(
    userId,
    row.authorizationDetails
  );
  const request: CibaRequestDetails = {
    ...requirement,
    ...(identityStrength ? { identity_strength: identityStrength } : {}),
    request_id: requestId,
    expires_at: row.expiresAt.toISOString(),
    scope: row.scope,
    status: row.status,
    ...(acrValues ? { acr_values: acrValues } : {}),
    ...(authorizationDetails
      ? { authorization_details: authorizationDetails }
      : {}),
    ...(row.bindingMessage ? { binding_message: row.bindingMessage } : {}),
    ...(row.clientId ? { client_id: row.clientId } : {}),
    ...(row.clientName ? { client_name: row.clientName } : {}),
  };

  return { agentIdentity, registeredAgent, request };
}

interface ApprovalPageSearchParams {
  [key: string]: string | string[] | undefined;
}

export function buildStandaloneApprovalPath(
  requestId: string,
  searchParams: ApprovalPageSearchParams = {}
): string {
  const url = new URL(
    `/approve/${encodeURIComponent(requestId)}`,
    "http://localhost"
  );

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry);
      }
      continue;
    }

    url.searchParams.set(key, value);
  }

  return `${url.pathname}${url.search}`;
}
