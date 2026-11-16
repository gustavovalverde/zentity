import type { CibaApproval } from "@/lib/db/schema/ciba";

import { describe, expect, it } from "vitest";

import { agentApprovalFor } from "@/lib/agents/approval-record";
import { resolveOversightMethod } from "@/lib/agents/claims";

// R5: oversight states the recorded method, never a ranking of the method
// against the capability's catalog strength.
describe("resolveOversightMethod", () => {
  it.each(["capability_grant", "session", "user_verification"] as const)(
    "states the recorded %s method as is",
    (method) => {
      expect(resolveOversightMethod(method)).toBe(method);
    }
  );

  it.each([null, undefined, "", "user", "biometric", "email", "none"])(
    "states no method for %j, which no approval records",
    (method) => {
      expect(resolveOversightMethod(method)).toBeNull();
    }
  );
});

describe("agentApprovalFor", () => {
  const decidedAt = new Date(1_770_000_000_000);
  const approval: CibaApproval = {
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
    requestedAt: decidedAt,
    decidedAt,
    expiresAt: decidedAt,
    tokenJti: null,
    tokenAudience: null,
    tokenIssuedAt: null,
    pohMintedAt: null,
    pohJti: null,
  };

  it("reads the agent and its authorization from the record", () => {
    expect(agentApprovalFor(approval)).toEqual({
      sessionId: "session-1",
      attestation: { provider: "AgentPass", tier: "attested", verified: true },
      authorization: {
        capabilities: [{ action: "check_compliance" }],
        oversight: { method: "session", approved_at: 1_770_000_000 },
        delegation: { depth: 0, max_depth: 1 },
        aap_claims_version: 2,
      },
    });
  });

  it("names no agent when no verified assertion bound the request", () => {
    expect(agentApprovalFor({ ...approval, agentSessionId: null })).toBeNull();
  });
});
