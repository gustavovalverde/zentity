import { describe, expect, it } from "vitest";

import { buildCibaPushPayload } from "../push-sender";

const APPROVAL_URL = "https://app.zentity.xyz/approve?auth_req_id=req-1";

describe("buildCibaPushPayload", () => {
  it("sets requiresVaultUnlock to true for identity-scoped requests", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid identity.name identity.dob",
    });

    expect(payload.data.requiresVaultUnlock).toBe(true);
  });

  it("sets requiresVaultUnlock to false for non-identity requests", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req-2",
      approvalUrl: APPROVAL_URL,
      scope: "openid proof:identity",
    });

    expect(payload.data.requiresVaultUnlock).toBe(false);
  });

  it("sets requiresVaultUnlock to true when any identity scope is present", () => {
    for (const scope of [
      "identity.name",
      "identity.dob",
      "identity.address",
      "identity.document",
      "identity.nationality",
    ]) {
      const payload = buildCibaPushPayload({
        authReqId: "req-x",
        approvalUrl: APPROVAL_URL,
        scope: `openid ${scope}`,
      });
      expect(payload.data.requiresVaultUnlock).toBe(true);
    }
  });

  it("passes the plugin-built approvalUrl through to the payload", () => {
    const payload = buildCibaPushPayload({
      authReqId: "abc-123",
      approvalUrl: "https://app.zentity.xyz/approve?auth_req_id=abc-123",
      scope: "openid",
    });

    expect(payload.data.approvalUrl).toBe(
      "https://app.zentity.xyz/approve?auth_req_id=abc-123"
    );
  });

  it("carries the raw authReqId in the payload data", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req/with spaces",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.data.authReqId).toBe("req/with spaces");
  });

  it("uses client name in body when provided", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
      clientName: "Aether AI",
    });

    expect(payload.body).toBe("Aether AI is requesting access");
  });

  it("falls back to 'An application' when clientName is absent", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.body).toBe("An application is requesting access");
  });

  it("defaults title to 'An application is requesting access' when no agentName", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
    });

    expect(payload.title).toBe("An application is requesting access");
  });

  it("uses agentName in title when provided", () => {
    const payload = buildCibaPushPayload({
      authReqId: "req-1",
      approvalUrl: APPROVAL_URL,
      scope: "openid",
      agentName: "Claude Code",
    });

    expect(payload.title).toBe("Claude Code requests approval");
  });
});
