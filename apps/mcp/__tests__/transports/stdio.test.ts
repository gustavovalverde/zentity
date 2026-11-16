import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockClearCachedHostId,
  mockClearMcpOAuthTokens,
  mockEnsureMcpOAuthSession,
  mockEnsureHostRegistered,
  mockPrepareBootstrapRegistrationAuth,
  mockRefreshMcpOAuthSession,
  mockRegisterAgentSession,
} = vi.hoisted(() => ({
  mockClearCachedHostId: vi.fn(),
  mockEnsureMcpOAuthSession: vi.fn(),
  mockRefreshMcpOAuthSession: vi.fn(),
  mockClearMcpOAuthTokens: vi.fn(),
  mockEnsureHostRegistered: vi.fn(),
  mockPrepareBootstrapRegistrationAuth: vi.fn(),
  mockRegisterAgentSession: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
  },
}));

vi.mock("../../src/oauth-client.js", () => ({
  clearMcpOAuthTokens: mockClearMcpOAuthTokens,
  ensureMcpOAuthSession: mockEnsureMcpOAuthSession,
  refreshMcpOAuthSession: mockRefreshMcpOAuthSession,
}));

vi.mock("../../src/runtime/agent-registration.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/runtime/agent-registration.js")
  >("../../src/runtime/agent-registration.js");
  return {
    ...actual,
    clearCachedHostId: mockClearCachedHostId,
    ensureHostRegistered: mockEnsureHostRegistered,
    prepareBootstrapRegistrationAuth: mockPrepareBootstrapRegistrationAuth,
    registerAgentSession: mockRegisterAgentSession,
  };
});

import { AgentRegistrationError, buildHostKeyNamespace } from "@zentity/sdk";
import { bootstrapRegisteredRuntime } from "../../src/transports/stdio.js";

const baseOauth = {
  accessToken: "access-token",
  accountSub: "",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { crv: "P-256", kty: "EC" },
    publicJwk: { crv: "P-256", kty: "EC" },
  },
  scopes: [],
};

const runtime = {
  display: {
    model: "claude",
    name: "Claude Code",
    runtime: "node",
    version: "1.2.3",
  },
  grants: [],
  hostId: "host-123",
  sessionDid: "did:key:zSession",
  sessionId: "session-123",
  sessionPrivateKey: { crv: "Ed25519", d: "priv", kty: "OKP", x: "pub" },
  sessionPublicKey: { crv: "Ed25519", kty: "OKP", x: "pub" },
  status: "active",
};

const hostKeyNamespace = buildHostKeyNamespace(baseOauth);
const bootstrapOauth = {
  ...baseOauth,
  accessToken: "bootstrap-token",
};

const CLAUDE_CODE = { name: "claude-code", version: "1.2.3" };

describe("bootstrapRegisteredRuntime", () => {
  beforeEach(() => {
    mockEnsureMcpOAuthSession.mockReset();
    mockRefreshMcpOAuthSession.mockReset();
    mockClearCachedHostId.mockReset();
    mockClearMcpOAuthTokens.mockReset();
    mockEnsureHostRegistered.mockReset();
    mockPrepareBootstrapRegistrationAuth.mockReset();
    mockRegisterAgentSession.mockReset();

    mockEnsureMcpOAuthSession.mockResolvedValue(baseOauth);
    mockPrepareBootstrapRegistrationAuth.mockResolvedValue(bootstrapOauth);
    mockEnsureHostRegistered.mockResolvedValue("host-123");
    mockRegisterAgentSession.mockResolvedValue(runtime);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers the runtime with the connected client's identity", async () => {
    const auth = await bootstrapRegisteredRuntime(CLAUDE_CODE);

    expect(mockPrepareBootstrapRegistrationAuth).toHaveBeenCalledWith(
      baseOauth
    );
    expect(mockRegisterAgentSession).toHaveBeenCalledWith(
      "http://localhost:3000",
      bootstrapOauth,
      "host-123",
      expect.objectContaining({
        model: "claude",
        name: "Claude Code",
        version: "1.2.3",
      }),
      hostKeyNamespace
    );
    expect(auth).toEqual({ oauth: baseOauth, runtime });
  });

  it("allows an explicit env override when clientInfo is absent", async () => {
    vi.stubEnv("ZENTITY_AGENT_NAME", "Custom Agent");

    await bootstrapRegisteredRuntime(undefined);

    expect(mockRegisterAgentSession).toHaveBeenCalledWith(
      "http://localhost:3000",
      bootstrapOauth,
      "host-123",
      expect.objectContaining({
        model: "unknown",
        name: "Custom Agent",
      }),
      hostKeyNamespace
    );
  });

  it("fails clearly when no runtime identity source is available", async () => {
    await expect(bootstrapRegisteredRuntime(undefined)).rejects.toThrow(
      "MCP clientInfo is required"
    );
  });

  it("clears stale tokens and re-authenticates when registration loses scope", async () => {
    const refreshedOauth = {
      ...baseOauth,
      accessToken: "fresh-token",
    };
    mockEnsureMcpOAuthSession
      .mockResolvedValueOnce(baseOauth)
      .mockResolvedValueOnce(refreshedOauth);
    mockEnsureHostRegistered
      .mockRejectedValueOnce(
        new AgentRegistrationError(
          "Host registration failed: 403 Missing required scope",
          403,
          "Missing required scope"
        )
      )
      .mockResolvedValueOnce("host-456");
    mockRegisterAgentSession.mockResolvedValueOnce({
      ...runtime,
      hostId: "host-456",
    });

    const result = await bootstrapRegisteredRuntime(CLAUDE_CODE);

    expect(mockClearMcpOAuthTokens).toHaveBeenCalledTimes(1);
    expect(mockEnsureMcpOAuthSession).toHaveBeenCalledTimes(2);
    expect(result.oauth.accessToken).toBe("fresh-token");
  });

  it("does not sign in again for other bootstrap exchange failures", async () => {
    mockPrepareBootstrapRegistrationAuth.mockRejectedValueOnce(
      new Error("Token exchange failed: 503 unavailable")
    );

    await expect(bootstrapRegisteredRuntime(CLAUDE_CODE)).rejects.toThrow(
      "Token exchange failed: 503 unavailable"
    );
    expect(mockClearMcpOAuthTokens).not.toHaveBeenCalled();
  });

  it("re-registers the durable host when the cached host id is stale", async () => {
    mockRegisterAgentSession
      .mockRejectedValueOnce(
        new AgentRegistrationError(
          "Agent registration failed: 404 Host not found",
          404,
          "Host not found"
        )
      )
      .mockResolvedValueOnce({
        ...runtime,
        sessionId: "session-456",
      });

    const result = await bootstrapRegisteredRuntime(CLAUDE_CODE);

    expect(mockClearCachedHostId).toHaveBeenCalledWith(
      "http://localhost:3000",
      hostKeyNamespace
    );
    expect(mockPrepareBootstrapRegistrationAuth).toHaveBeenCalled();
    expect(mockEnsureHostRegistered).toHaveBeenCalledTimes(2);
    expect(mockRegisterAgentSession).toHaveBeenCalledTimes(2);
    expect(result.runtime.sessionId).toBe("session-456");
  });

  it("does not auto-heal host key mismatches", async () => {
    mockRegisterAgentSession.mockRejectedValueOnce(
      new AgentRegistrationError(
        "Agent registration failed: 401 Invalid host JWT",
        401,
        "Invalid host JWT"
      )
    );

    await expect(bootstrapRegisteredRuntime(CLAUDE_CODE)).rejects.toThrow(
      "Agent registration failed: 401 Invalid host JWT"
    );

    expect(mockClearCachedHostId).not.toHaveBeenCalled();
    expect(mockClearMcpOAuthTokens).not.toHaveBeenCalled();
    expect(mockEnsureHostRegistered).toHaveBeenCalledTimes(1);
    expect(mockRegisterAgentSession).toHaveBeenCalledTimes(1);
  });

  // R36: credentials stored before the login carried the bootstrap scopes.
  describe("credentials from before the bootstrap scopes", () => {
    const freshOauth = {
      ...baseOauth,
      accessToken: "fresh-token",
      scopes: [
        "openid",
        "agent:host.register",
        "agent:session.register",
        "agent:session.revoke",
      ],
    };

    async function freshBootstrap() {
      vi.resetModules();
      const stdio = await import("../../src/transports/stdio.js");
      return stdio.bootstrapRegisteredRuntime;
    }

    it("signs in again when the stored login lacks a bootstrap scope", async () => {
      mockEnsureMcpOAuthSession
        .mockResolvedValueOnce({ ...baseOauth, scopes: ["openid", "email"] })
        .mockResolvedValueOnce(freshOauth);
      const bootstrap = await freshBootstrap();

      const result = await bootstrap(CLAUDE_CODE);

      expect(mockClearMcpOAuthTokens).toHaveBeenCalledTimes(1);
      expect(mockEnsureMcpOAuthSession).toHaveBeenCalledTimes(2);
      expect(mockPrepareBootstrapRegistrationAuth).toHaveBeenCalledWith(
        freshOauth
      );
      expect(mockEnsureHostRegistered).toHaveBeenCalledTimes(1);
      expect(mockRegisterAgentSession).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ oauth: freshOauth, runtime });
    });

    it("signs in again once when the bootstrap exchange refuses the stored login", async () => {
      mockEnsureMcpOAuthSession
        .mockResolvedValueOnce(baseOauth)
        .mockResolvedValueOnce(freshOauth);
      mockPrepareBootstrapRegistrationAuth
        .mockRejectedValueOnce(
          new Error(
            'Token exchange failed: 400 {"error":"invalid_scope","error_description":"scope agent:host.register is not available through token exchange"}'
          )
        )
        .mockResolvedValueOnce(bootstrapOauth);
      const bootstrap = await freshBootstrap();

      const result = await bootstrap(CLAUDE_CODE);

      expect(mockClearMcpOAuthTokens).toHaveBeenCalledTimes(1);
      expect(mockEnsureMcpOAuthSession).toHaveBeenCalledTimes(2);
      expect(mockPrepareBootstrapRegistrationAuth).toHaveBeenLastCalledWith(
        freshOauth
      );
      expect(mockRegisterAgentSession).toHaveBeenCalledTimes(1);
      expect(result.oauth).toBe(freshOauth);

      // A second refusal in the same process is reported, not retried.
      mockPrepareBootstrapRegistrationAuth.mockRejectedValueOnce(
        new Error('Token exchange failed: 400 {"error":"invalid_request"}')
      );
      await expect(bootstrap(CLAUDE_CODE)).rejects.toThrow(
        "Token exchange failed: 400"
      );
      expect(mockClearMcpOAuthTokens).toHaveBeenCalledTimes(1);
    });
  });
});
