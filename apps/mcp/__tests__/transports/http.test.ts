import type { JWTPayload } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TokenAuthError,
  TokenAuthResult,
} from "../../src/auth/token-auth.js";

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
      url: string,
      requiredScopes?: string[]
    ) => Promise<TokenAuthResult | TokenAuthError>
  >();

vi.mock("../../src/auth/token-auth.js", () => ({
  validateToken: (...args: unknown[]) =>
    mockValidateToken(
      args[0] as string | undefined,
      args[1] as string | undefined,
      args[2] as string,
      args[3] as string,
      args[4] as string[] | undefined
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
    scope: "openid",
  }),
}));

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
import {
  createApp,
  matchOrigin,
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
  description: string,
  scope?: string
): TokenAuthError {
  const parts = [
    'Bearer realm="zentity-mcp"',
    `error="${error}"`,
    `error_description="${description}"`,
    'resource_metadata="http://localhost:3200/.well-known/oauth-protected-resource"',
  ];
  if (scope) {
    parts.push(`scope="${scope}"`);
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
      scope: "openid",
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
    expect(body.authorization_servers).toContain(
      "http://localhost:3000/api/auth"
    );
    expect(body.bearer_methods_supported).toEqual(["header", "dpop"]);
    expect(body.scopes_supported).toEqual([
      "openid",
      "compliance:key:read",
      "proof:identity",
      "email",
    ]);
  });

  it("serves a remote-client metadata document without bootstrap grants", async () => {
    const res = await app.request("/.well-known/oauth-client.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.scope).toBe("openid");
    expect(body.scope).not.toContain("offline_access");
  });

  it("returns 401 with resource_metadata when no auth header", async () => {
    mockValidateToken.mockResolvedValue(
      authError(
        401,
        "invalid_request",
        "Missing Authorization header",
        "openid"
      )
    );

    const res = await app.request("/mcp", { method: "POST" });
    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).toContain("resource_metadata");
    expect(wwwAuth).toContain('scope="openid"');

    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("returns 403 with resource_metadata and scope for insufficient scopes", async () => {
    mockValidateToken.mockResolvedValue(
      authError(
        403,
        "insufficient_scope",
        "Token missing required scope(s): email",
        "openid email"
      )
    );

    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer no-scope-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "whoami", arguments: {} },
      }),
    });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe("insufficient_scope");

    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).toContain("resource_metadata");
    expect(wwwAuth).toContain('scope="openid email"');
  });

  it("uses minimal scopes for initialize", async () => {
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
    expect(mockValidateToken).toHaveBeenCalledWith(
      "Bearer valid-token",
      undefined,
      "POST",
      expect.stringContaining("/mcp"),
      ["openid"]
    );
  });

  it("challenges whoami with account scopes", async () => {
    mockValidateToken.mockResolvedValue(
      validPayload({ scope: "openid email" })
    );

    await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "whoami", arguments: {} },
      }),
    });

    expect(mockValidateToken).toHaveBeenCalledWith(
      "Bearer valid-token",
      undefined,
      "POST",
      expect.stringContaining("/mcp"),
      ["openid", "email"]
    );
  });

  it("challenges proof tools with proof scopes", async () => {
    mockValidateToken.mockResolvedValue(
      validPayload({ scope: "openid proof:identity" })
    );

    await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "my_proofs", arguments: {} },
      }),
    });

    expect(mockValidateToken).toHaveBeenCalledWith(
      "Bearer valid-token",
      undefined,
      "POST",
      expect.stringContaining("/mcp"),
      ["openid", "proof:identity"]
    );
  });

  it("creates an MCP session with a valid token after downstream token exchange", async () => {
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

  it("rejects reusing a session id across different principals", async () => {
    mockValidateToken.mockResolvedValueOnce(validPayload({ sub: "user-123" }));

    const initialize = await app.request("/mcp", {
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

    expect(initialize.status).toBe(200);
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    mockValidateToken.mockResolvedValueOnce(validPayload({ sub: "user-456" }));

    const reuse = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer other-valid-token",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "mcp-session-id": sessionId ?? "",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 2,
        params: {},
      }),
    });

    expect(reuse.status).toBe(403);
    await expect(reuse.json()).resolves.toEqual({
      error: "Session principal mismatch",
    });
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

  it("accepts DPoP tokens with valid proof", async () => {
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
