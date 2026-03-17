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

vi.mock("../../src/server/index.js", () => ({
  createServer: vi.fn(() => ({
    server: { connect: vi.fn() },
    cleanup: vi.fn(),
  })),
}));

import {
  createApp,
  matchOrigin,
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
    setServerCredentials({
      clientId: "test-client",
      dpopKey: {
        privateJwk: { kty: "EC", crv: "P-256" },
        publicJwk: { kty: "EC", crv: "P-256" },
      },
    });
    app = createApp();
  });

  // PRD case 8: Health endpoint accessible without auth
  it("serves /health without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  // PRD case 9: Metadata endpoint accessible without auth
  it("serves /.well-known/oauth-protected-resource without auth", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toBe("http://localhost:3200");
    expect(body.authorization_servers).toContain("http://localhost:3000");
    expect(body.scopes_supported).toContain("openid");
  });

  // PRD case 1: No Authorization header → 401 with resource_metadata
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

  // PRD case 3: Expired JWT → 401 with error="invalid_token"
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

  // PRD case 4: JWT with wrong issuer → 401
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

  // PRD case 5: Insufficient scopes → 403 with error="insufficient_scope"
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

  // PRD case 2: Valid JWT → MCP session created
  it("creates MCP session with valid token", async () => {
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

    // MCP SDK returns 200 with session header on successful initialize
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });

  // PRD case 7: DPoP-bound token without proof → 401
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

  // PRD case 6: DPoP-bound token with valid proof → accepted
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

  // PRD case 10: CORS — only localhost origins allowed
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
    // Hono CORS middleware returns empty string for disallowed origins
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
