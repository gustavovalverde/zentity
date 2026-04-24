import { AAP_CLAIMS_VERSION } from "@zentity/sdk/protocol";
import { describe, expect, it } from "vitest";

import {
  buildAapClaims,
  DelegationDepthExceededError,
  deriveDelegationClaim,
  getAapClaimsFromPayload,
} from "@/lib/agents/claims";

describe("AAP claims", () => {
  it("builds canonical access token claims", () => {
    const claims = buildAapClaims({
      act: {
        did: "did:key:z6MkAgent",
        hostAttestation: "attested",
        hostId: "host-1",
        operator: "user-1",
        sessionId: "session-1",
        sub: "agent-sub",
        type: "agent",
      },
      audit: {
        cibaRequestId: "ciba-1",
        contextId: "context-1",
        releaseId: "release-1",
        requestId: "request-1",
      },
      capabilities: [
        { action: "read_profile" },
        { action: "" },
        { action: "purchase", constraints: { max_amount: 50 } },
      ],
      oversight: {
        approvalId: "approval-1",
        approvedAt: 1_770_000_000,
        method: "biometric",
      },
      task: {
        constraints: { merchant: "example" },
        createdAt: 1_770_000_000,
        description: "Buy wine",
        expiresAt: 1_770_000_600,
        hash: "task-hash",
      },
    });

    expect(claims).toEqual({
      aap_claims_version: AAP_CLAIMS_VERSION,
      act: {
        did: "did:key:z6MkAgent",
        host_attestation: "attested",
        host_id: "host-1",
        operator: "user-1",
        session_id: "session-1",
        sub: "agent-sub",
        type: "agent",
      },
      audit: {
        ciba_request_id: "ciba-1",
        context_id: "context-1",
        release_id: "release-1",
        request_id: "request-1",
      },
      capabilities: [
        { action: "purchase", constraints: { max_amount: 50 } },
        { action: "read_profile" },
      ],
      delegation: {
        depth: 0,
        max_depth: 1,
        parent_jti: null,
      },
      oversight: {
        approval_id: "approval-1",
        approved_at: 1_770_000_000,
        method: "biometric",
      },
      task: {
        constraints: { merchant: "example" },
        created_at: 1_770_000_000,
        description: "Buy wine",
        expires_at: 1_770_000_600,
        hash: "task-hash",
      },
    });
  });

  it("omits optional actor and task fields when they are not claimable", () => {
    const claims = buildAapClaims({
      act: {
        did: "did:key:z6MkUntrusted",
        hostAttestation: "unverified",
        sessionId: "session-1",
        sub: "agent-sub",
      },
      audit: {
        contextId: "context-1",
        releaseId: "release-1",
      },
      delegation: {
        depth: 1,
        max_depth: 2,
        parent_jti: "parent-1",
      },
      oversight: {
        approvalId: "approval-1",
        approvedAt: 1_770_000_000,
        method: "session",
      },
      task: {
        createdAt: 1_770_000_000,
        description: "Read profile",
        expiresAt: 1_770_000_600,
        hash: "task-hash",
      },
    });

    expect(claims.act).toEqual({
      host_attestation: "unverified",
      session_id: "session-1",
      sub: "agent-sub",
    });
    expect(claims.task).not.toHaveProperty("constraints");
    expect(claims.audit).not.toHaveProperty("request_id");
    expect(claims.delegation).toEqual({
      depth: 1,
      max_depth: 2,
      parent_jti: "parent-1",
    });
  });

  it("parses valid claims from a raw token payload", () => {
    const claims = getAapClaimsFromPayload({
      aap_claims_version: AAP_CLAIMS_VERSION,
      act: {
        did: "did:key:z6MkAgent",
        host_attestation: "attested",
        host_id: "host-1",
        operator: "user-1",
        session_id: "session-1",
        sub: "agent-sub",
        type: "agent",
      },
      audit: {
        ciba_request_id: "ciba-1",
        context_id: "context-1",
        release_id: "release-1",
        request_id: "request-1",
      },
      capabilities: [
        { action: "read_profile" },
        null,
        { action: "purchase", constraints: { max_amount: 50 } },
        { constraints: { ignored: true } },
      ],
      delegation: {
        depth: 1,
        max_depth: 2,
      },
      oversight: {
        approval_id: "approval-1",
        approved_at: 1_770_000_000,
        method: "email",
      },
      task: {
        constraints: { merchant: "example" },
        created_at: 1_770_000_000,
        description: "Buy wine",
        expires_at: 1_770_000_600,
        hash: "task-hash",
      },
    });

    expect(claims.act?.did).toBe("did:key:z6MkAgent");
    expect(claims.audit?.ciba_request_id).toBe("ciba-1");
    expect(claims.capabilities).toEqual([
      { action: "purchase", constraints: { max_amount: 50 } },
      { action: "read_profile" },
    ]);
    expect(claims.delegation).toEqual({
      depth: 1,
      max_depth: 2,
      parent_jti: null,
    });
    expect(claims.task?.constraints).toEqual({ merchant: "example" });
    expect(claims.aap_claims_version).toBe(AAP_CLAIMS_VERSION);
  });

  it("ignores malformed claim groups", () => {
    expect(
      getAapClaimsFromPayload({
        aap_claims_version: "legacy",
        act: { sub: "agent-sub" },
        audit: { release_id: "release-1" },
        capabilities: [{ constraints: { ignored: true } }],
        delegation: { depth: 1, max_depth: "2", parent_jti: 42 },
        oversight: { approval_id: "approval-1", approved_at: "now" },
        task: { hash: "task-hash", description: "Task" },
      })
    ).toEqual({ capabilities: [] });
  });

  it("derives bounded delegation depth", () => {
    expect(deriveDelegationClaim({ parent: null })).toEqual({
      depth: 1,
      max_depth: 1,
      parent_jti: null,
    });

    expect(
      deriveDelegationClaim({
        parent: {
          delegation: {
            depth: 1,
            max_depth: 3,
            parent_jti: "parent-1",
          },
        },
        parentJti: "override-parent",
      })
    ).toEqual({
      depth: 2,
      max_depth: 3,
      parent_jti: "override-parent",
    });
  });

  it("rejects delegation beyond the parent max depth", () => {
    expect(() =>
      deriveDelegationClaim({
        parent: {
          delegation: {
            depth: 1,
            max_depth: 1,
            parent_jti: null,
          },
        },
      })
    ).toThrow(DelegationDepthExceededError);
  });
});
