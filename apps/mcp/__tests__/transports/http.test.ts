import type { JWTPayload } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TokenAuthError,
  TokenAuthResult,
} from "../../src/auth/token-auth.js";

const {
  mockClearCachedHostId,
  mockEnsureHostRegistered,
  mockPrepareBootstrapRegistrationAuth,
  mockRegisterAgent,
} = vi.hoisted(() => ({
  mockClearCachedHostId: vi.fn(),
  mockEnsureHostRegistered: vi.fn(),
  mockPrepareBootstrapRegistrationAuth: vi.fn(),
  mockRegisterAgent: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "http",
    allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
  },
}));

const mockValidateToken =
  vi.fn<
    (
      authHeader: string | undefined,
      dpopHeader: string | undefined,
      method: string,
      url: string
    ) => Promise<TokenAuthResult | TokenAuthError>
  >();

vi.mock("../../src/auth/token-auth.js", () => ({
  validateToken: (...args: unknown[]) =>
    mockValidateToken(
      args[0] as string | undefined,
      args[1] as string | undefined,
      args[2] as string,
      args[3] as string
    ),
  isAuthError: (result: unknown) =>
    typeof result === "object" && result !== null && "status" in result,
  resetJwks: vi.fn(),
}));

vi.mock("../../src/auth/token-exchange.js", () => ({
  exchangeToken: vi.fn().mockResolvedValue({
    accessToken: "exchanged-token-123",
    tokenType: "DPoP",
    expiresIn: 3600,
  }),
  resolveLoginHint: vi.fn().mockResolvedValue("user-123@example.com"),
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
    registerAgent: mockRegisterAgent,
  };
});

vi.mock("../../src/auth/discovery.js", () => ({
  discover: vi.fn().mockResolvedValue({
    issuer: "http://localhost:3000/api/auth",
    token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
    authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
  }),
}));

vi.mock("../../src/server/index.js", () => ({
  createServer: vi.fn(() => ({
    server: { connect: vi.fn() },
    cleanup: vi.fn(),
  })),
}));

import { discover } from "../../src/auth/discovery.js";
import { exchangeToken } from "../../src/auth/token-exchange.js";
import { buildHostKeyNamespace } from "../../src/auth/agent-registration.js";
import {
  createApp,
  ensureSessionRuntime,
  matchOrigin,
  registerHttpRuntime,
  resolveTokenExchangeAudience,
  setServerCredentials,
} from "../../src/transports/http.js";

function validPayload(overrides: Partial<JWTPayload> = {}): TokenAuthResult {
  return {
    scheme: "Bearer",
    payload: {
      sub: "user-123",
      client_id: "test-client",
      scope: "openid",
      iss: "http://localhost:3000",
      ...overrides,
    },
  };
}

function authError(
  status: 401 | 403,
  error: string,
  description: string
): TokenAuthError {
  const parts = [
    'Bearer realm="zentity-mcp"',
    `error="${error}"`,
    `error_description="${description}"`,
  ];
  if (status === 401) {
    parts.push(
      'resource_metadata="http://localhost:3200/.well-known/oauth-protected-resource"'
    );
  }
  return {
    status,
    wwwAuthenticate: parts.join(", "),
    body: { error, error_description: description },
  };
}

describe("matchOrigin", () => {
  const patterns = ["http://localhost:*", "http://127.0.0.1:*"];

  it("matches localhost with any port", () => {
    expect(matchOrigin("http://localhost:3000", patterns)).toBe(
      "http://localhost:3000"
    );
    expect(matchOrigin("http://localhost:8080", patterns)).toBe(
      "http://localhost:8080"
    );
  });

  it("matches 127.0.0.1 with any port", () => {
    expect(matchOrigin("http://127.0.0.1:5173", patterns)).toBe(
      "http://127.0.0.1:5173"
    );
  });

  it("rejects non-localhost origins", () => {
    expect(matchOrigin("https://evil.com", patterns)).toBeUndefined();
    expect(matchOrigin("http://example.com:3000", patterns)).toBeUndefined();
  });

  it("matches exact patterns", () => {
    expect(matchOrigin("http://specific.dev", ["http://specific.dev"])).toBe(
      "http://specific.dev"
    );
  });
});

describe("HTTP transport middleware", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockValidateToken.mockReset();
    vi.mocked(discover).mockResolvedValue({
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
    });
    vi.mocked(exchangeToken).mockResolvedValue({
      accessToken: "exchanged-token-123",
      tokenType: "DPoP",
      expiresIn: 3600,
    });
    setServerCredentials({
      clientId: "test-client",
      dpopKey: {
        privateJwk: { kty: "EC", crv: "P-256" },
        publicJwk: { kty: "EC", crv: "P-256" },
      },
    });
    app = createApp();
  });

  it("serves /health without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("serves /.well-known/oauth-protected-resource without auth", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("http://localhost:3200");
    expect(body.authorization_servers).toContain("http://localhost:3000");
    expect(body.scopes_supported).toContain("openid");
  });

  it("returns 401 with resource_metadata when no auth header", async () => {
    mockValidateToken.mockResolvedValue(
      authError(401, "invalid_request", "Missing Authorization header")
    );

    const res = await app.request("/mcp", { method: "POST" });
    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).toContain("resource_metadata");
    expect(wwwAuth).toContain("oauth-protected-resource");

    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 401 for expired token", async () => {
    mockValidateToken.mockResolvedValue(
      authError(401, "invalid_token", "Token has expired")
    );

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer expired-token" },
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe("invalid_token");
    expect(body.error_description).toContain("expired");
  });

  it("returns 401 for token with wrong issuer", async () => {
    mockValidateToken.mockResolvedValue(
      authError(401, "invalid_token", "Unexpected issuer")
    );

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-issuer-token" },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_token");
  });

  it("returns 403 for insufficient scopes", async () => {
    mockValidateToken.mockResolvedValue(
      authError(
        403,
        "insufficient_scope",
        "Token missing required scope(s): openid"
      )
    );

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer no-scope-token" },
    });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe("insufficient_scope");

    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).not.toContain("resource_metadata");
  });

  it("creates MCP session with valid token after token exchange", async () => {
    mockValidateToken.mockResolvedValue(validPayload());

    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-token",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    expect(exchangeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectToken: "valid-token",
        audience: "http://localhost:3000",
        clientId: "test-client",
      })
    );
  });

  it("derives token exchange audience from the discovered public issuer", async () => {
    mockValidateToken.mockResolvedValue(validPayload());
    vi.mocked(discover).mockResolvedValueOnce({
      issuer: "https://public.example/base/api/auth",
      token_endpoint: "http://internal-web:3000/api/auth/oauth2/token",
      authorization_endpoint:
        "https://public.example/base/api/auth/oauth2/authorize",
    });

    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-token",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(exchangeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "https://public.example/base",
      })
    );
  });

  it("returns 502 when token exchange fails", async () => {
    mockValidateToken.mockResolvedValue(validPayload());
    vi.mocked(exchangeToken).mockRejectedValueOnce(
      new Error("Token exchange failed: 400 invalid_grant")
    );

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(502);
const body = await res.json();
    expect(body.error).toBe("token_exchange_failed");
  });

  it("returns 401 for DPoP token without proof", async () => {
    mockValidateToken.mockResolvedValue(
      authError(401, "invalid_token", "Missing DPoP proof header")
    );

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: "DPoP some-token" },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain("DPoP");
  });

  it("accepts DPoP token with valid proof", async () => {
    mockValidateToken.mockResolvedValue({
      scheme: "DPoP",
      payload: {
        sub: "user-123",
        client_id: "test-client",
        scope: "openid",
        cnf: { jkt: "test-thumbprint" },
      },
      dpopPublicJwk: { kty: "EC", crv: "P-256" },
    });

    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "DPoP valid-dpop-token",
        DPoP: "valid-proof-jwt",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
  });

  it("sets CORS headers for allowed localhost origin", async () => {
    const res = await app.request("/health", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000"
    );
  });

  it("rejects CORS from non-localhost origin", async () => {
    const res = await app.request("/health", {
      headers: { Origin: "https://evil.com" },
    });
    const acao = res.headers.get("Access-Control-Allow-Origin");
    expect(acao === null || acao === "").toBe(true);
  });

  it("passes auth header and DPoP header to validateToken", async () => {
    mockValidateToken.mockResolvedValue(
      authError(401, "invalid_token", "test")
    );

    await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer my-token",
        DPoP: "my-proof",
      },
    });

    expect(mockValidateToken).toHaveBeenCalledWith(
      "Bearer my-token",
      "my-proof",
      "POST",
      expect.stringContaining("/mcp")
    );
  });
});

describe("HTTP runtime registration", () => {
  const oauth = {
    accessToken: "exchanged-token-123",
    clientId: "test-client",
    dpopKey: {
      privateJwk: { kty: "EC", crv: "P-256" },
      publicJwk: { kty: "EC", crv: "P-256" },
    },
    loginHint: "user-123",
  };
  const bootstrapAuth = {
    ...oauth,
    accessToken: "bootstrap-token-123",
  };

  beforeEach(() => {
    mockClearCachedHostId.mockReset();
    mockEnsureHostRegistered.mockReset();
    mockPrepareBootstrapRegistrationAuth.mockReset();
    mockRegisterAgent.mockReset();
    mockPrepareBootstrapRegistrationAuth.mockResolvedValue(bootstrapAuth);
  });

  it("registers a runtime with a user-scoped host namespace", async () => {
    const runtime = {
      display: {
        model: "unknown",
        name: "@zentity/mcp-server",
        runtime: "node",
        version: "unknown",
      },
      grants: [],
      hostId: "host-123",
      sessionId: "session-123",
      sessionPrivateKey: { kty: "OKP", crv: "Ed25519", d: "priv", x: "pub" },
      sessionPublicKey: { kty: "OKP", crv: "Ed25519", x: "pub" },
    };
    mockEnsureHostRegistered.mockResolvedValue("host-123");
    mockRegisterAgent.mockResolvedValue(runtime);

    const result = await registerHttpRuntime(oauth);

    const namespace = buildHostKeyNamespace(oauth);
    expect(mockPrepareBootstrapRegistrationAuth).toHaveBeenCalledWith(oauth);
    expect(mockEnsureHostRegistered).toHaveBeenCalledWith(
      "http://localhost:3000",
      bootstrapAuth,
      "@zentity/mcp-server",
      namespace
    );
    expect(mockRegisterAgent).toHaveBeenCalledWith(
      "http://localhost:3000",
      bootstrapAuth,
      "host-123",
      expect.objectContaining({
        model: "unknown",
        name: "@zentity/mcp-server",
      }),
      namespace
    );
    expect(result).toEqual(runtime);
  });

  it("reuses the cached runtime for repeat requests in the same MCP session", async () => {
    const runtime = {
      display: {
        model: "unknown",
        name: "@zentity/mcp-server",
        runtime: "node",
        version: "unknown",
      },
      grants: [],
      hostId: "host-123",
      sessionId: "session-123",
      sessionPrivateKey: { kty: "OKP", crv: "Ed25519", d: "priv", x: "pub" },
      sessionPublicKey: { kty: "OKP", crv: "Ed25519", x: "pub" },
    };
    const runtimes = new Map<string, (typeof runtime)>();
    mockEnsureHostRegistered.mockResolvedValue("host-123");
    mockRegisterAgent.mockResolvedValue(runtime);

    const first = await ensureSessionRuntime(
      runtimes,
      "mcp-session-1",
      oauth
    );
    const second = await ensureSessionRuntime(
      runtimes,
      "mcp-session-1",
      {
        ...oauth,
        accessToken: "exchanged-token-456",
      }
    );

    expect(first).toEqual(runtime);
    expect(second).toBe(runtime);
    expect(mockEnsureHostRegistered).toHaveBeenCalledTimes(1);
    expect(mockRegisterAgent).toHaveBeenCalledTimes(1);
  });
});

describe("resolveTokenExchangeAudience", () => {
  it("strips the auth issuer suffix to recover the app audience", () => {
    expect(
      resolveTokenExchangeAudience("https://public.example/base/api/auth")
    ).toBe("https://public.example/base");
  });

  it("falls back to the normalized issuer when the path is not an auth issuer", () => {
    expect(resolveTokenExchangeAudience("https://public.example/custom/")).toBe(
      "https://public.example/custom"
    );
  });
});
