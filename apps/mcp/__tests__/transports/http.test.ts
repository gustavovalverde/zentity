import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  exportJWK,
  generateKeyPair,
  type CryptoKey as JoseCryptoKey,
  type JWTPayload,
  SignJWT,
} from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const ISSUER = "http://localhost:3000/api/auth";
const JWKS_URL = "http://localhost:3000/api/auth/oauth2/jwks";
const MCP_URL = "http://localhost:3200/mcp";
const RESOURCE_METADATA_URL =
  "http://localhost:3200/.well-known/oauth-protected-resource";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "http",
    allowedOrigins: ["http://localhost:*", "http://127.0.0.1:*"],
  },
}));

const { mockExchangeToken, mockFetchAccountSummary } = vi.hoisted(() => ({
  mockExchangeToken: vi.fn(),
  mockFetchAccountSummary: vi.fn(),
}));

vi.mock("@zentity/sdk/fpa", () => ({
  exchangeToken: mockExchangeToken,
}));

vi.mock("../../src/services/account-summary.js", () => ({
  fetchAccountSummary: mockFetchAccountSummary,
}));

import { createApp, matchOrigin } from "../../src/transports/http.js";

const SUMMARY = {
  authStrength: "strong",
  checks: null,
  email: null,
  humanity: { proven: false, sources: [] },
  loginMethod: "passkey",
  memberSince: "2026-01-01",
  profileToolHint: "my_profile",
  tier: 2,
  tierName: "Verified",
  vaultFieldsAvailable: ["name", "address", "birthdate"],
  verificationStrength: "documentary_full",
};

let signingKey: JoseCryptoKey;
let jwks: { keys: Record<string, unknown>[] };

function signAccessToken(claims: JWTPayload = {}): Promise<string> {
  return new SignJWT({
    aud: "http://localhost:3200",
    azp: "remote-client",
    scope: "openid",
    sub: "user-123",
    ...claims,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: "at+jwt" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signingKey);
}

function createTestApp() {
  return createApp(
    {
      clientId: "mcp-server-client",
      dpopClient: {} as never,
      dpopKey: {} as never,
    },
    {
      issuer: ISSUER,
      jwksUrl: JWKS_URL,
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
    }
  );
}

function connectClient(
  app: ReturnType<typeof createTestApp>,
  token: string,
  options: ConstructorParameters<typeof Client>[1] = {}
) {
  const client = new Client({ name: "http-test", version: "1.0.0" }, options);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (url, init) => app.request(url.toString(), init),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  return client.connect(transport).then(() => client);
}

function postToolCall(
  app: ReturnType<typeof createTestApp>,
  token: string | undefined,
  name: string
) {
  return app.request(MCP_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  signingKey = pair.privateKey;
  jwks = {
    keys: [
      { ...(await exportJWK(pair.publicKey)), alg: "EdDSA", kid: "test-key" },
    ],
  };
});

beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
    String(input instanceof Request ? input.url : input) === JWKS_URL
      ? Promise.resolve(Response.json(jwks))
      : realFetch(input, init)
  );
  mockExchangeToken.mockResolvedValue({
    accessToken: "exchanged-token",
    accountSub: "user-123",
    expiresIn: 3600,
    scope: "openid",
    tokenType: "DPoP",
  });
  mockFetchAccountSummary.mockResolvedValue(SUMMARY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matchOrigin", () => {
  const patterns = ["http://localhost:*", "http://127.0.0.1:*"];

  it("matches loopback origins on any port", () => {
    expect(matchOrigin("http://localhost:8080", patterns)).toBe(
      "http://localhost:8080"
    );
    expect(matchOrigin("http://127.0.0.1:3000", patterns)).toBe(
      "http://127.0.0.1:3000"
    );
  });

  it("rejects other origins", () => {
    expect(matchOrigin("https://evil.example", patterns)).toBeUndefined();
  });
});

describe("HTTP transport", () => {
  it("serves /health without auth", async () => {
    const res = await createTestApp().request("/health");
    expect(res.status).toBe(200);
  });

  it("publishes its protected resource metadata", async () => {
    const res = await createTestApp().request(
      "/.well-known/oauth-protected-resource"
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.resource).toBe("http://localhost:3200");
    expect(body.authorization_servers).toEqual([ISSUER]);
    expect(body.scopes_supported).toEqual([
      "openid",
      "email",
      "compliance:read",
      "proof:identity",
    ]);
  });

  it("challenges unauthenticated requests with the resource metadata URL", async () => {
    const res = await postToolCall(createTestApp(), undefined, "whoami");

    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${RESOURCE_METADATA_URL}"`
    );
  });

  it("rejects tokens audienced to another resource", async () => {
    const token = await signAccessToken({ aud: "http://localhost:3000" });

    const res = await postToolCall(createTestApp(), token, "whoami");

    expect(res.status).toBe(401);
  });

  it("rejects DPoP-bound tokens presented without a DPoP proof", async () => {
    const token = await signAccessToken({ cnf: { jkt: "thumbprint" } });

    const res = await postToolCall(createTestApp(), token, "whoami");

    expect(res.status).toBe(401);
  });

  it("serves whoami to a 2025-era client after token exchange", async () => {
    const app = createTestApp();
    const token = await signAccessToken();
    const client = await connectClient(app, token);

    const result = await client.callTool({ name: "whoami", arguments: {} });

    expect(client.getProtocolEra()).toBe("legacy");
    expect(result.structuredContent).toMatchObject({
      tier: 2,
      tierName: "Verified",
    });
    expect(mockExchangeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "http://localhost:3000",
        clientId: "mcp-server-client",
        subjectToken: token,
      })
    );
  });

  it("serves whoami to a 2026-07-28 client", async () => {
    const app = createTestApp();
    const client = await connectClient(app, await signAccessToken(), {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    });

    const result = await client.callTool({ name: "whoami", arguments: {} });

    expect(client.getProtocolEra()).toBe("modern");
    expect(result.structuredContent).toMatchObject({ tier: 2 });
  });

  it("challenges a tool call that needs more scope", async () => {
    const token = await signAccessToken({ scope: "openid" });

    const res = await postToolCall(createTestApp(), token, "check_compliance");
    const challenge = res.headers.get("WWW-Authenticate") ?? "";

    expect(res.status).toBe(403);
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="openid compliance:read"');
    expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`);
    expect(mockExchangeToken).not.toHaveBeenCalled();
  });

  it("reports a failed downstream token exchange as a tool error", async () => {
    mockExchangeToken.mockRejectedValueOnce(new Error("exchange failed"));
    const client = await connectClient(
      createTestApp(),
      await signAccessToken()
    );

    const result = await client.callTool({ name: "whoami", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "exchange failed" }]);
  });

  it("exchanges the caller token only when a tool needs it", async () => {
    const client = await connectClient(
      createTestApp(),
      await signAccessToken()
    );

    await client.listTools();

    expect(mockExchangeToken).not.toHaveBeenCalled();
  });

  it("allows CORS from loopback origins only", async () => {
    const app = createTestApp();
    const allowed = await app.request("/health", {
      headers: { Origin: "http://localhost:6274" },
    });
    const denied = await app.request("/health", {
      headers: { Origin: "https://evil.example" },
    });

    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:6274"
    );
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
