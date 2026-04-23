import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockClearCachedHostId,
  mockClearTokenCredentials,
  mockEnsureAuthenticated,
  mockEnsureHostRegistered,
  mockPrepareBootstrapRegistrationAuth,
  mockRefreshAuthContext,
  mockRegisterAgentSession,
} = vi.hoisted(() => ({
  mockClearCachedHostId: vi.fn(),
  mockEnsureAuthenticated: vi.fn(),
  mockRefreshAuthContext: vi.fn(),
  mockClearTokenCredentials: vi.fn(),
  mockEnsureHostRegistered: vi.fn(),
  mockPrepareBootstrapRegistrationAuth: vi.fn(),
  mockRegisterAgentSession: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
  },
}));

vi.mock("../../src/auth/bootstrap.js", () => ({
  ensureAuthenticated: mockEnsureAuthenticated,
  refreshAuthContext: mockRefreshAuthContext,
}));

vi.mock("../../src/auth/credentials.js", () => ({
  clearTokenCredentials: mockClearTokenCredentials,
}));

vi.mock("../../src/auth/agent-registration.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/auth/agent-registration.js")
  >("../../src/auth/agent-registration.js");
  return {
    ...actual,
    clearCachedHostId: mockClearCachedHostId,
    ensureHostRegistered: mockEnsureHostRegistered,
    prepareBootstrapRegistrationAuth: mockPrepareBootstrapRegistrationAuth,
    registerAgentSession: mockRegisterAgentSession,
  };
});

import {
  AgentRegistrationError,
  buildHostKeyNamespace,
} from "../../src/auth/agent-registration.js";
import { bootstrapRegisteredRuntime } from "../../src/transports/stdio.js";

const baseOauth = {
  accessToken: "access-token",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { crv: "P-256", kty: "EC" },
    publicJwk: { crv: "P-256", kty: "EC" },
  },
  loginHint: "user-123",
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

function createServerMock(clientInfo?: { name: string; version: string }) {
  return {
    server: {
      getClientVersion: vi.fn().mockReturnValue(clientInfo),
    },
  } as const;
}

function deferredPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("bootstrapRegisteredRuntime", () => {
  beforeEach(() => {
    mockEnsureAuthenticated.mockReset();
    mockRefreshAuthContext.mockReset();
    mockClearCachedHostId.mockReset();
    mockClearTokenCredentials.mockReset();
    mockEnsureHostRegistered.mockReset();
    mockPrepareBootstrapRegistrationAuth.mockReset();
    mockRegisterAgentSession.mockReset();

    mockEnsureAuthenticated.mockResolvedValue({
      oauth: baseOauth,
      accessTokenProvider: { getAccessToken: vi.fn() },
    });
    mockPrepareBootstrapRegistrationAuth.mockResolvedValue(bootstrapOauth);
    mockEnsureHostRegistered.mockResolvedValue("host-123");
    mockRegisterAgentSession.mockResolvedValue(runtime);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("waits for initialization before registering the runtime and uses MCP clientInfo", async () => {
    const initialized = deferredPromise();
    const server = createServerMock({ name: "claude-code", version: "1.2.3" });

    const bootstrapPromise = bootstrapRegisteredRuntime(
      server as never,
      initialized.promise
    );

    await Promise.resolve();
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled();

    initialized.resolve();
    await bootstrapPromise;

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1);
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
  });

  it("allows an explicit env override when clientInfo is absent", async () => {
    vi.stubEnv("ZENTITY_AGENT_NAME", "Custom Agent");

    await bootstrapRegisteredRuntime(
      createServerMock(undefined) as never,
      Promise.resolve()
    );

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
    await expect(
      bootstrapRegisteredRuntime(
        createServerMock(undefined) as never,
        Promise.resolve()
      )
    ).rejects.toThrow("MCP clientInfo is required");
  });

  it("clears stale tokens and re-authenticates when registration loses scope", async () => {
    const refreshedOauth = {
      ...baseOauth,
      accessToken: "fresh-token",
    };
    mockEnsureAuthenticated
      .mockResolvedValueOnce({
        oauth: baseOauth,
        accessTokenProvider: { getAccessToken: vi.fn() },
      })
      .mockResolvedValueOnce({
        oauth: refreshedOauth,
        accessTokenProvider: { getAccessToken: vi.fn() },
      });
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

    const result = await bootstrapRegisteredRuntime(
      createServerMock({ name: "claude-code", version: "1.2.3" }) as never,
      Promise.resolve()
    );

    expect(mockClearTokenCredentials).toHaveBeenCalledWith(
      "http://localhost:3000"
    );
    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(2);
    expect(result.oauth.accessToken).toBe("fresh-token");
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

    const result = await bootstrapRegisteredRuntime(
      createServerMock({ name: "claude-code", version: "1.2.3" }) as never,
      Promise.resolve()
    );

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

    await expect(
      bootstrapRegisteredRuntime(
        createServerMock({ name: "claude-code", version: "1.2.3" }) as never,
        Promise.resolve()
      )
    ).rejects.toThrow("Agent registration failed: 401 Invalid host JWT");

    expect(mockClearCachedHostId).not.toHaveBeenCalled();
    expect(mockClearTokenCredentials).not.toHaveBeenCalled();
    expect(mockEnsureHostRegistered).toHaveBeenCalledTimes(1);
    expect(mockRegisterAgentSession).toHaveBeenCalledTimes(1);
  });
});
