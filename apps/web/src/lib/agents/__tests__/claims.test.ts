import type { CibaApproval } from "@/lib/db/schema/ciba";

import {
  PAYMENT_AUTHORIZATION_CAPABILITY,
  PAYMENT_AUTHORIZATION_TYPE,
} from "@zentity/sdk/protocol";
import { describe, expect, it } from "vitest";

import { buildAgentAuthorization } from "@/lib/agents/claims";

const DECIDED_AT = new Date(1_770_000_000_000);

function approval(overrides: Partial<CibaApproval> = {}): CibaApproval {
  return {
    id: "approval-1",
    referenceId: "auth-req-hash",
    requestId: "request-1",
    userId: "user-1",
    clientId: "client-1",
    scope: "openid compliance:read",
    bindingMessage: "Check compliance",
    authorizationDetails: null,
    acrValues: null,
    decision: "approved",
    approvalMethod: "session",
    approvalChannel: "page",
    capability: null,
    grantId: null,
    hostPolicyId: null,
    constraints: null,
    agentSessionId: "session-1",
    hostId: "host-1",
    attestationTier: "attested",
    attestationProvider: "AgentPass",
    authContextId: "context-1",
    requestedAt: DECIDED_AT,
    decidedAt: DECIDED_AT,
    expiresAt: DECIDED_AT,
    tokenJti: null,
    tokenAudience: null,
    tokenIssuedAt: null,
    ...overrides,
  };
}

describe("buildAgentAuthorization", () => {
  // R2: what an approval authorizes travels in the token response, with no
  // task, audit, approval id, or parent token.
  it("states a grant approval's capability and its constraints", () => {
    const authorization = buildAgentAuthorization(
      approval({
        approvalMethod: "capability_grant",
        approvalChannel: "grant",
        capability: "check_compliance",
        constraints: [{ field: "x", op: "eq", value: 1 }],
        grantId: "grant-1",
        hostPolicyId: "policy-1",
      })
    );

    expect(authorization).toEqual({
      capabilities: [
        {
          action: "check_compliance",
          constraints: [{ field: "x", op: "eq", value: 1 }],
        },
      ],
      oversight: { method: "capability_grant", approved_at: 1_770_000_000 },
      delegation: { depth: 0, max_depth: 1 },
      aap_claims_version: 2,
    });
  });

  // A manual approval records no capability; the policy table names what the
  // stored request asked for, so a client can tell what was approved.
  it("names the capabilities a manual approval's request maps to", () => {
    expect(
      buildAgentAuthorization(
        approval({
          approvalMethod: "user_verification",
          scope: "openid proof:age identity.name",
          authorizationDetails: JSON.stringify([
            { type: PAYMENT_AUTHORIZATION_TYPE },
          ]),
        })
      )?.capabilities
    ).toEqual(
      [PAYMENT_AUTHORIZATION_CAPABILITY, "my_profile", "my_proofs"]
        .toSorted()
        .map((action) => ({ action }))
    );
  });

  it("names no capability for a request the catalog does not cover", () => {
    expect(
      buildAgentAuthorization(approval({ scope: "openid email" }))?.capabilities
    ).toEqual([]);
  });

  it("authorizes nothing for a denial or an unrecorded method", () => {
    expect(
      buildAgentAuthorization(
        approval({ decision: "denied", approvalMethod: null })
      )
    ).toBeNull();
    expect(
      buildAgentAuthorization(approval({ approvalMethod: null }))
    ).toBeNull();
  });
});
