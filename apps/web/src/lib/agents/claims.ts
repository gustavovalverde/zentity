import type {
  AgentAuthorization,
  CapabilityClaim,
  OversightMethod,
} from "@zentity/sdk/protocol";
import type { CibaApproval } from "@/lib/db/schema/ciba";

import { AAP_CLAIMS_VERSION } from "@zentity/sdk/protocol";

import { requestCapabilities } from "./capability";

/** The recorded approval method, or null when none was recorded. */
export function resolveOversightMethod(
  approvalMethod: string | null | undefined
): OversightMethod | null {
  switch (approvalMethod) {
    case "capability_grant":
    case "session":
    case "user_verification":
      return approvalMethod;
    default:
      return null;
  }
}

/**
 * The capabilities an approval covers. A grant approval names the grant's
 * capability with the constraints it was evaluated against. A manual
 * approval names the capabilities the approval policy maps the stored
 * request to, without constraints: the user approved the request's own
 * scopes and details, which the token carries.
 */
function approvedCapabilities(approval: CibaApproval): CapabilityClaim[] {
  if (approval.approvalMethod === "capability_grant") {
    if (!approval.capability) {
      return [];
    }
    const constraints = approval.constraints ?? undefined;
    return [
      {
        action: approval.capability,
        ...(constraints === undefined ? {} : { constraints }),
      },
    ];
  }
  return requestCapabilities({
    scope: approval.scope ?? "",
    authorizationDetails: approval.authorizationDetails,
  }).map((action) => ({ action }));
}

/**
 * What an agent-backed approval authorizes, for the CIBA token response and
 * agent introspection; access tokens no longer carry it. Null when the
 * record holds no approval.
 */
export function buildAgentAuthorization(
  approval: CibaApproval
): AgentAuthorization | null {
  const method = resolveOversightMethod(approval.approvalMethod);
  if (approval.decision !== "approved" || !method) {
    return null;
  }
  return {
    capabilities: approvedCapabilities(approval),
    oversight: {
      method,
      approved_at: Math.floor(approval.decidedAt.getTime() / 1000),
    },
    delegation: { depth: 0, max_depth: 1 },
    aap_claims_version: AAP_CLAIMS_VERSION,
  };
}
