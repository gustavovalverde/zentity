import { beforeEach, describe, expect, it, vi } from "vitest";

// Imported dynamically in beforeEach to pick up mocked derived-keys
let createScopeHash: typeof import("@/lib/auth/oidc/disclosure/delivery").createScopeHash;
let verifyIdentityIntentToken: typeof import("@/lib/auth/oidc/disclosure/delivery").verifyIdentityIntentToken;

const STABLE_INTENT_KEY = "deadbeef".repeat(8);

vi.mock("@/env", () => ({
  env: { BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long" },
}));

vi.mock("@/lib/privacy/primitives/derived-keys", () => ({
  getIdentityIntentKey: () => STABLE_INTENT_KEY,
}));

const { mockVerifySignedOAuthQuery } = vi.hoisted(() => ({
  mockVerifySignedOAuthQuery: vi.fn<(q: string) => Promise<URLSearchParams>>(),
}));

vi.mock("@/lib/auth/oidc/oauth-request", () => ({
  verifySignedOAuthQuery: mockVerifySignedOAuthQuery,
  parseRequestedScopes: (params: URLSearchParams) =>
    (params.get("scope") ?? "")
      .split(" ")
      .map((s) => s.trim())
      .filter(Boolean),
}));

vi.mock("@/lib/http/rate-limiters", () => ({
  oauth2IdentityLimiter: { check: () => ({ limited: false }) },
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireBrowserSession: vi.fn(),
}));

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/oauth2/identity/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function oauthQuery(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

describe("oauth2 identity intent route", () => {
  let POST: (req: Request) => Promise<Response>;
  let requireBrowserSession: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const routeMod = await import("../route");
    POST = routeMod.POST;
    const intentMod = await import("@/lib/auth/oidc/disclosure/delivery");
    createScopeHash = intentMod.createScopeHash;
    verifyIdentityIntentToken = intentMod.verifyIdentityIntentToken;
    const authMod = await import("@/lib/auth/api-auth");
    requireBrowserSession = vi.mocked(authMod.requireBrowserSession);

    vi.clearAllMocks();
    requireBrowserSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    } as never);
    mockVerifySignedOAuthQuery.mockImplementation(
      async (q: string) => new URLSearchParams(q)
    );
  });

  it("rejects unauthenticated requests", async () => {
    requireBrowserSession.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "content-type": "application/json" } }
      ),
    } as never);

    const response = await POST(makeRequest({}));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  it("rejects invalid oauth query signature", async () => {
    mockVerifySignedOAuthQuery.mockRejectedValueOnce(
      new Error("invalid_signature")
    );

    const response = await POST(
      makeRequest({
        oauth_query: "client_id=client-1&scope=openid%20identity.name&sig=bad",
        scopes: ["openid", "identity.name"],
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid OAuth query",
    });
  });

  it("rejects requests without identity scopes", async () => {
    const query = oauthQuery({
      client_id: "client-1",
      scope: "openid email",
    });

    const response = await POST(
      makeRequest({
        oauth_query: query,
        scopes: ["openid", "email"],
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "At least one identity scope is required",
    });
  });

  it("issues a signed identity intent token", async () => {
    const scopes = ["openid", "identity.name", "identity.dob"];
    const query = oauthQuery({
      client_id: "client-1",
      scope: scopes.join(" "),
    });

    const response = await POST(
      makeRequest({
        oauth_query: query,
        scopes,
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      intent_token: string;
      expires_at: number;
    };
    expect(typeof body.intent_token).toBe("string");
    expect(typeof body.expires_at).toBe("number");

    const payload = await verifyIdentityIntentToken(body.intent_token);
    expect(payload.userId).toBe("user-1");
    expect(payload.clientId).toBe("client-1");
    expect(payload.scopeHash).toBe(createScopeHash(scopes));
    expect(payload.exp).toBe(body.expires_at);
  });
});
