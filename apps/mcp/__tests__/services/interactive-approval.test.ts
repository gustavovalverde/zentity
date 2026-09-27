import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { DpopKeyPair } from "@zentity/sdk/rp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthSessionContext } from "../../src/runtime/auth-context.js";

const mockBeginCibaApproval = vi.fn();
const mockPollCibaTokenOnce = vi.fn();

vi.mock("../../src/config.js", () => ({
  config: {
    transport: "http",
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3300",
  },
}));

vi.mock("@zentity/sdk", () => ({
  beginCibaApproval: (...args: unknown[]) => mockBeginCibaApproval(...args),
  createPendingApproval: vi.fn(),
  logPendingApprovalHandoff: vi.fn(),
  pollCibaTokenOnce: (...args: unknown[]) => mockPollCibaTokenOnce(...args),
}));

import {
  beginOrResumeInteractiveFlow,
  requestUserAction,
} from "../../src/services/interactive-approval.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const oauth: OAuthSessionContext = {
  accessToken: "access-token",
  accountSub: "user-123",
  clientId: "client-123",
  dpopClient: {
    keyPair: mockDpopKey,
    proofFor: vi.fn(),
    withNonceRetry: vi.fn(),
  },
  dpopKey: mockDpopKey,
  scopes: ["openid"],
};

function createParams(fingerprint: string) {
  return {
    toolName: "my_profile" as const,
    fingerprint,
    oauth,
    cibaRequest: {
      cibaEndpoint: "http://localhost:3000/api/auth/oauth2/bc-authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: oauth.clientId,
      dpopSigner: oauth.dpopClient,
      loginHint: oauth.accountSub,
      scope: "openid identity.name",
      bindingMessage: "Claude Code: Share my name",
      resource: "http://localhost:3000",
    },
    browserSearchParams: { fields: "name" },
    onApproved: (tokenSet: { accessToken: string }) =>
      Promise.resolve({ token: tokenSet.accessToken }),
  };
}

const PENDING = {
  authReqId: "auth-req-1",
  expiresIn: 300,
  intervalSeconds: 5,
};

describe("interactive tool flow", () => {
  beforeEach(() => {
    mockBeginCibaApproval.mockReset();
    mockPollCibaTokenOnce.mockReset();
    mockBeginCibaApproval.mockResolvedValue(PENDING);
  });

  it("starts a CIBA request and returns the browser interaction", async () => {
    const outcome = await beginOrResumeInteractiveFlow(createParams("start"));

    expect(outcome.status).toBe("needs_user_action");
    if (outcome.status !== "needs_user_action") {
      return;
    }
    const url = new URL(outcome.interaction.url);
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname.startsWith("/mcp/interactive/")).toBe(true);
    expect(url.searchParams.get("authReqId")).toBe("auth-req-1");
    expect(url.searchParams.get("tool")).toBe("my_profile");
    expect(url.searchParams.get("fields")).toBe("name");
    expect(mockPollCibaTokenOnce).not.toHaveBeenCalled();
  });

  it("keeps waiting while the approval is pending", async () => {
    await beginOrResumeInteractiveFlow(createParams("pending"));
    mockPollCibaTokenOnce.mockResolvedValue({
      status: "pending",
      pendingAuthorization: PENDING,
    });

    const outcome = await beginOrResumeInteractiveFlow(createParams("pending"));

    expect(outcome.status).toBe("needs_user_action");
    expect(mockBeginCibaApproval).toHaveBeenCalledTimes(1);
  });

  it("completes with the approved token and forgets the flow", async () => {
    await beginOrResumeInteractiveFlow(createParams("approved"));
    mockPollCibaTokenOnce.mockResolvedValueOnce({
      status: "approved",
      tokenSet: { accessToken: "approved-token" },
    });

    const outcome = await beginOrResumeInteractiveFlow(
      createParams("approved")
    );
    expect(outcome).toEqual({
      status: "complete",
      data: { token: "approved-token" },
    });

    await beginOrResumeInteractiveFlow(createParams("approved"));
    expect(mockBeginCibaApproval).toHaveBeenCalledTimes(2);
  });

  it("reports denial and expiry", async () => {
    await beginOrResumeInteractiveFlow(createParams("denied"));
    mockPollCibaTokenOnce.mockResolvedValueOnce({
      status: "denied",
      message: "User denied",
    });
    await expect(
      beginOrResumeInteractiveFlow(createParams("denied"))
    ).resolves.toEqual({ status: "denied" });

    await beginOrResumeInteractiveFlow(createParams("expired"));
    mockPollCibaTokenOnce.mockResolvedValueOnce({ status: "timed_out" });
    await expect(
      beginOrResumeInteractiveFlow(createParams("expired"))
    ).resolves.toEqual({ status: "expired" });
  });

  it("keeps the flow when a poll fails", async () => {
    await beginOrResumeInteractiveFlow(createParams("flaky"));
    mockPollCibaTokenOnce.mockRejectedValueOnce(new Error("network down"));

    const outcome = await beginOrResumeInteractiveFlow(createParams("flaky"));

    expect(outcome.status).toBe("needs_user_action");
  });
});

describe("requestUserAction", () => {
  const interaction = {
    mode: "url" as const,
    url: "http://localhost:3000/mcp/interactive/abc",
    message: "Open the link",
    expiresAt: "2026-09-27T12:00:00.000Z",
  };
  const fallback = { structuredContent: { status: "needs_user_action" } };

  function serverWith(capabilities: unknown) {
    return {
      server: { getClientCapabilities: () => capabilities },
    } as unknown as McpServer;
  }

  function contextWith(mcpReq: Record<string, unknown> = {}) {
    return { mcpReq } as unknown as ServerContext;
  }

  it("asks URL-elicitation clients to open the approval page", () => {
    const result = requestUserAction(
      serverWith({ elicitation: { url: {} } }),
      contextWith(),
      interaction,
      fallback
    );

    expect(result).toMatchObject({
      inputRequests: {
        approval: {
          method: "elicitation/create",
          params: {
            mode: "url",
            url: interaction.url,
            message: interaction.message,
          },
        },
      },
    });
  });

  it("reads client capabilities from the per-request envelope", () => {
    const result = requestUserAction(
      serverWith(undefined),
      contextWith({
        envelope: {
          "io.modelcontextprotocol/clientCapabilities": {
            elicitation: { url: {} },
          },
        },
      }),
      interaction,
      fallback
    );

    expect(result).not.toBe(fallback);
  });

  it("returns the structured result to clients without URL elicitation", () => {
    expect(
      requestUserAction(
        serverWith({ elicitation: { form: {} } }),
        contextWith(),
        interaction,
        fallback
      )
    ).toBe(fallback);
  });

  it("does not ask again once the client answered", () => {
    expect(
      requestUserAction(
        serverWith({ elicitation: { url: {} } }),
        contextWith({ inputResponses: { approval: { action: "accept" } } }),
        interaction,
        fallback
      )
    ).toBe(fallback);
  });
});
