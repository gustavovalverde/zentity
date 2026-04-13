import { beforeEach, describe, expect, it, vi } from "vitest";

import { createIdentityIntentToken } from "@/lib/auth/oidc/disclosure/delivery";

vi.mock("@/env", () => ({
  env: { BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long" },
}));

const { mockStagePendingOauthDisclosure } = vi.hoisted(() => ({
  mockStagePendingOauthDisclosure: vi.fn(),
}));
const { mockComputeOAuthRequestKey, mockVerifySignedOAuthQuery } = vi.hoisted(
  () => ({
    mockComputeOAuthRequestKey: vi.fn(),
    mockVerifySignedOAuthQuery: vi.fn(),
  })
);

vi.mock("@/lib/auth/oidc/disclosure/context", () => ({
  stagePendingOauthDisclosure: mockStagePendingOauthDisclosure,
}));
vi.mock("@/lib/auth/oidc/oauth-request", () => ({
  computeOAuthRequestKey: mockComputeOAuthRequestKey,
  parseRequestedScopes: (queryParams: URLSearchParams) =>
    (queryParams.get("scope") ?? "")
      .split(" ")
      .map((scope) => scope.trim())
      .filter(Boolean),
  verifySignedOAuthQuery: mockVerifySignedOAuthQuery,
}));

vi.mock("@/lib/auth/auth-config", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

// Mock api-auth to prevent the real module from caching in vmThreads.
// Without this, the real api-auth module (loaded transitively through the route)
// persists in the VM cache and can't be overridden by subsequent test files.
vi.mock("@/lib/auth/resource-auth", () => ({
  requireBrowserSession: vi.fn(),
}));

import { requireBrowserSession } from "@/lib/auth/resource-auth";

import { POST } from "../route";

function makeOAuthQuery(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/oauth2/identity/stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("oauth2 identity stage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireBrowserSession).mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    } as never);
    mockStagePendingOauthDisclosure.mockResolvedValue({ ok: true });
    mockComputeOAuthRequestKey.mockReturnValue("oauth-request-key");
    mockVerifySignedOAuthQuery.mockImplementation(
      async (query: string) => new URLSearchParams(query)
    );
  });

  it("requires intent_token when identity scopes are requested", async () => {
    const scopes = ["openid", "identity.name"];
    const oauthQuery = makeOAuthQuery({
      client_id: "client-1",
      scope: scopes.join(" "),
    });

    const response = await POST(
      makeRequest({
        oauth_query: oauthQuery,
        scopes,
        identity: { given_name: "Ada" },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing intent_token for identity scopes",
    });
  });

  it("rejects expired intent tokens", async () => {
    const scopes = ["openid", "identity.name"];
    const oauthQuery = makeOAuthQuery({
      client_id: "client-1",
      scope: scopes.join(" "),
    });
    const expiredIntent = await createIdentityIntentToken({
      userId: "user-1",
      clientId: "client-1",
      scopes,
      ttlSeconds: -1,
    });

    const response = await POST(
      makeRequest({
        oauth_query: oauthQuery,
        scopes,
        intent_token: expiredIntent.intentToken,
        identity: { given_name: "Ada" },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or expired intent token",
    });
  });

  it("rejects scope mismatch between intent token and stage request", async () => {
    const tokenScopes = ["openid", "identity.name"];
    const requestScopes = ["openid", "identity.name", "identity.dob"];
    const oauthQuery = makeOAuthQuery({
      client_id: "client-1",
      scope: requestScopes.join(" "),
    });
    const intent = await createIdentityIntentToken({
      userId: "user-1",
      clientId: "client-1",
      scopes: tokenScopes,
    });

    const response = await POST(
      makeRequest({
        oauth_query: oauthQuery,
        scopes: requestScopes,
        intent_token: intent.intentToken,
        identity: { given_name: "Ada", birthdate: "1990-01-01" },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Intent token does not match request context",
    });
  });

  it("rejects reused intent tokens", async () => {
    const scopes = ["openid", "identity.name"];
    const oauthQuery = makeOAuthQuery({
      client_id: "client-1",
      scope: scopes.join(" "),
    });
    const intent = await createIdentityIntentToken({
      userId: "user-1",
      clientId: "client-1",
      scopes,
    });

    const body = {
      oauth_query: oauthQuery,
      scopes,
      intent_token: intent.intentToken,
      identity: { given_name: "Ada" },
    };

    const first = await POST(makeRequest(body));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ staged: true });

    mockStagePendingOauthDisclosure.mockResolvedValueOnce({
      ok: false,
      reason: "intent_reused",
    });
    const second = await POST(makeRequest(body));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: "Identity intent token has already been used",
    });
  });

  it("rejects concurrent stages for the same authorization request", async () => {
    const scopes = ["openid", "identity.name"];
    const oauthQuery = makeOAuthQuery({
      client_id: "client-1",
      scope: scopes.join(" "),
    });
    const intent1 = await createIdentityIntentToken({
      userId: "user-1",
      clientId: "client-1",
      scopes,
    });
    const intent2 = await createIdentityIntentToken({
      userId: "user-1",
      clientId: "client-1",
      scopes,
    });

    const first = await POST(
      makeRequest({
        oauth_query: oauthQuery,
        scopes,
        intent_token: intent1.intentToken,
        identity: { given_name: "Ada" },
      })
    );
    expect(first.status).toBe(200);

    mockStagePendingOauthDisclosure.mockResolvedValueOnce({
      ok: false,
      reason: "concurrent_stage",
    });
    const second = await POST(
      makeRequest({
        oauth_query: oauthQuery,
        scopes,
        intent_token: intent2.intentToken,
        identity: { given_name: "Grace" },
      })
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error:
        "An active identity stage already exists for this authorization request.",
    });
  });
});
