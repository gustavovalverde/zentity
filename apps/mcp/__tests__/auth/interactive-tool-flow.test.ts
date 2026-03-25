import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthSessionContext } from "../../src/auth/context.js";
import type { DpopKeyPair } from "../../src/auth/dpop.js";

const mockBeginCibaApproval = vi.fn();
const mockLogPendingApprovalHandoff = vi.fn();
const mockPollCibaTokenOnce = vi.fn();

vi.mock("../../src/config.js", () => ({
  config: {
    transport: "http",
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3300",
  },
}));

vi.mock("../../src/auth/ciba.js", () => ({
  beginCibaApproval: (...args: unknown[]) => mockBeginCibaApproval(...args),
  createPendingApproval: (
    _params: { resource?: string | undefined },
    pendingAuthorization: {
      authReqId: string;
      expiresIn: number;
      intervalSeconds: number;
    }
  ) => ({
    approvalUrl: `http://localhost:3000/approve/${pendingAuthorization.authReqId}`,
    authReqId: pendingAuthorization.authReqId,
    expiresIn: pendingAuthorization.expiresIn,
    intervalSeconds: pendingAuthorization.intervalSeconds,
  }),
  logPendingApprovalHandoff: (...args: unknown[]) =>
    mockLogPendingApprovalHandoff(...args),
  pollCibaTokenOnce: (...args: unknown[]) => mockPollCibaTokenOnce(...args),
}));

import { beginOrResumeInteractiveFlow } from "../../src/auth/interactive-tool-flow.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const oauth: OAuthSessionContext = {
  accessToken: "access-token",
  accountSub: "user-123",
  clientId: "client-123",
  dpopKey: mockDpopKey,
  loginHint: "user@example.com",
  scopes: ["openid"],
};

function createServerDouble(notifier: ReturnType<typeof vi.fn>) {
  return {
    server: {
      createElicitationCompletionNotifier: () => notifier,
      getClientCapabilities: () => ({
        elicitation: {
          url: {},
        },
      }),
    },
  } as const;
}

function createParams(input: {
  fingerprint: string;
  notifier: ReturnType<typeof vi.fn>;
  onApproved?: (result: { accessToken: string }) => Promise<{ ok: true }>;
}) {
  return {
    server: createServerDouble(input.notifier),
    toolName: "my_profile" as const,
    fingerprint: input.fingerprint,
    oauth,
    cibaRequest: {
      cibaEndpoint: "http://localhost:3000/api/auth/oauth2/bc-authorize",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: oauth.clientId,
      dpopKey: oauth.dpopKey,
      loginHint: oauth.loginHint,
      scope: "openid identity.name",
      bindingMessage: "Claude Code: Share my name",
      resource: "http://localhost:3000",
    },
    onApproved:
      input.onApproved ??
      (async () => {
        return { ok: true as const };
      }),
  };
}

describe("interactive tool flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockBeginCibaApproval.mockReset();
    mockLogPendingApprovalHandoff.mockReset();
    mockPollCibaTokenOnce.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("notifies URL elicitation completion after background polling approves the flow", async () => {
    const notifier = vi.fn().mockResolvedValue(undefined);
    mockBeginCibaApproval.mockResolvedValue({
      authReqId: "auth-req-1",
      expiresIn: 300,
      intervalSeconds: 2,
    });
    mockPollCibaTokenOnce.mockResolvedValue({
      status: "approved",
      result: {
        accessToken: "approved-token",
      },
    });

    const first = await beginOrResumeInteractiveFlow(
      createParams({
        fingerprint: "fp-background",
        notifier,
      })
    );

    expect(first.status).toBe("needs_user_action");
    expect(notifier).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockPollCibaTokenOnce).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledTimes(1);

    const onApproved = vi.fn().mockResolvedValue({ ok: true as const });
    const resumed = await beginOrResumeInteractiveFlow(
      createParams({
        fingerprint: "fp-background",
        notifier,
        onApproved,
      })
    );

    expect(onApproved).toHaveBeenCalledWith({
      accessToken: "approved-token",
    });
    expect(resumed).toEqual({
      status: "complete",
      data: { ok: true },
    });
  });

  it("retries completion notification after a transient notifier failure", async () => {
    const notifier = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    mockBeginCibaApproval.mockResolvedValue({
      authReqId: "auth-req-retry",
      expiresIn: 300,
      intervalSeconds: 2,
    });
    mockPollCibaTokenOnce.mockResolvedValue({
      status: "approved",
      result: {
        accessToken: "approved-token",
      },
    });

    const first = await beginOrResumeInteractiveFlow(
      createParams({
        fingerprint: "fp-retry",
        notifier,
      })
    );

    expect(first.status).toBe("needs_user_action");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(notifier).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(notifier).toHaveBeenCalledTimes(2);
  });

  it("emits a first-party interaction URL without browser callback parameters", async () => {
    const notifier = vi.fn().mockResolvedValue(undefined);
    mockBeginCibaApproval.mockResolvedValue({
      authReqId: "auth-req-2",
      expiresIn: 300,
      intervalSeconds: 60,
    });

    const first = await beginOrResumeInteractiveFlow(
      createParams({
        fingerprint: "fp-url-shape",
        notifier,
      })
    );

    expect(first.status).toBe("needs_user_action");
    if (first.status !== "needs_user_action") {
      throw new Error("Expected interactive flow to require user action");
    }

    const browserUrl = new URL(first.interaction.url);
    expect(browserUrl.origin).toBe("http://localhost:3000");
    expect(browserUrl.pathname).toContain("/mcp/interactive/");
    expect(browserUrl.searchParams.get("authReqId")).toBe("auth-req-2");
    expect(browserUrl.searchParams.get("tool")).toBe("my_profile");
    expect(browserUrl.searchParams.has("callback")).toBe(false);
  });
});
