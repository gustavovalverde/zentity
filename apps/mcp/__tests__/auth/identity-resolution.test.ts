import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  config: { zentityUrl: "https://zentity.test" },
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

const mockBeginCibaApproval = vi.fn();
const mockCreatePendingApproval = vi.fn();
const mockLogPendingApprovalHandoff = vi.fn();
const mockPollCibaTokenOnce = vi.fn();
vi.mock("../../src/auth/ciba.js", () => ({
  beginCibaApproval: (...args: unknown[]) => mockBeginCibaApproval(...args),
  createPendingApproval: (...args: unknown[]) =>
    mockCreatePendingApproval(...args),
  logPendingApprovalHandoff: (...args: unknown[]) =>
    mockLogPendingApprovalHandoff(...args),
  pollCibaTokenOnce: (...args: unknown[]) => mockPollCibaTokenOnce(...args),
  requestCibaApproval: vi.fn(),
}));

const mockSignAgentAssertion = vi.fn();
vi.mock("../../src/auth/agent-registration.js", () => ({
  signAgentAssertion: (...args: unknown[]) => mockSignAgentAssertion(...args),
}));

const mockRequireAuth = vi.fn();
const mockGetOAuthContext = vi.fn();
const mockTryGetRuntimeState = vi.fn();
vi.mock("../../src/auth/context.js", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  getOAuthContext: (...args: unknown[]) => mockGetOAuthContext(...args),
  requireRuntimeState: vi.fn(),
  tryGetRuntimeState: (...args: unknown[]) => mockTryGetRuntimeState(...args),
}));

const dpopKey = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const mockRuntime = {
  display: { name: "test-agent" },
  grants: [],
  hostId: "host-1",
  sessionId: "session-1",
  sessionPrivateKey: { kty: "OKP", crv: "Ed25519" },
  sessionPublicKey: { kty: "OKP", crv: "Ed25519" },
};

function makeOAuth(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "token-abc",
    accountSub: "sub-1",
    clientId: "client-1",
    dpopKey,
    loginHint: "user@example.com",
    scopes: ["openid"],
    ...overrides,
  };
}

describe("getIdentityResolution – transport-agnostic", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ oauth: makeOAuth() });
    mockGetOAuthContext.mockReturnValue(makeOAuth());
    mockTryGetRuntimeState.mockReturnValue(undefined);
    mockBeginCibaApproval.mockResolvedValue({
      authReqId: "req-1",
      expiresIn: 300,
      intervalSeconds: 5,
    });
    mockCreatePendingApproval.mockReturnValue({
      approvalUrl: "https://zentity.test/approve/req-1?source=cli_handoff",
      authReqId: "req-1",
      expiresIn: 300,
      intervalSeconds: 5,
    });
  });

  it("initiates CIBA without agent assertion when no runtime", async () => {
    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    const result = await getIdentityResolution();

    expect(result.status).toBe("approval_required");
    expect(mockSignAgentAssertion).not.toHaveBeenCalled();

    const cibaRequest = mockBeginCibaApproval.mock.calls[0]?.[0];
    expect(cibaRequest.agentAssertion).toBeUndefined();
    expect(cibaRequest.bindingMessage).toBe("Unlock identity for this session");
  });

  it("includes agent assertion when runtime is available", async () => {
    mockTryGetRuntimeState.mockReturnValue(mockRuntime);
    mockSignAgentAssertion.mockResolvedValue("signed-assertion");

    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    const result = await getIdentityResolution();

    expect(result.status).toBe("approval_required");
    expect(mockSignAgentAssertion).toHaveBeenCalledWith(
      mockRuntime,
      "test-agent: Unlock identity for this session"
    );

    const cibaRequest = mockBeginCibaApproval.mock.calls[0]?.[0];
    expect(cibaRequest.agentAssertion).toBe("signed-assertion");
    expect(cibaRequest.bindingMessage).toBe(
      "test-agent: Unlock identity for this session"
    );
  });

  it("passes custom scope to CIBA request", async () => {
    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    await getIdentityResolution("openid identity.name");

    const cibaRequest = mockBeginCibaApproval.mock.calls[0]?.[0];
    expect(cibaRequest.scope).toBe("openid identity.name");
  });

  it("uses default scope when none provided", async () => {
    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    await getIdentityResolution();

    const cibaRequest = mockBeginCibaApproval.mock.calls[0]?.[0];
    expect(cibaRequest.scope).toBe("openid identity.name identity.address");
  });

  it("uses accountSub as loginHint when loginHint is empty", async () => {
    mockGetOAuthContext.mockReturnValue(makeOAuth({ loginHint: "" }));

    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    await getIdentityResolution();

    const cibaRequest = mockBeginCibaApproval.mock.calls[0]?.[0];
    expect(cibaRequest.loginHint).toBe("sub-1");
  });

  it("uses loginHint when available", async () => {
    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    await getIdentityResolution();

    const cibaRequest = mockBeginCibaApproval.mock.calls[0]?.[0];
    expect(cibaRequest.loginHint).toBe("user@example.com");
  });

  it("logs pending approval handoff", async () => {
    const { getIdentityResolution } = await import(
      "../../src/auth/identity.js"
    );
    await getIdentityResolution();

    expect(mockLogPendingApprovalHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ authReqId: "req-1" })
    );
  });
});
