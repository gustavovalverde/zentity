import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createScopeHash,
  verifyIdentityIntentToken,
} from "@/lib/auth/oidc/identity-intent";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

import { POST } from "../route";

async function makeSignedOAuthQuery(params: Record<string, string>) {
  const query = new URLSearchParams(params);
  query.set("exp", String(Math.floor(Date.now() / 1000) + 300));
  const sig = await makeSignature(
    query.toString(),
    process.env.BETTER_AUTH_SECRET as string
  );
  query.set("sig", sig);
  return query.toString();
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/oauth2/identity/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("oauth2 identity intent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
    authMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("rejects unauthenticated requests", async () => {
    authMocks.getSession.mockResolvedValueOnce(null);

    const response = await POST(makeRequest({}));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  it("rejects invalid oauth query signature", async () => {
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
    const oauthQuery = await makeSignedOAuthQuery({
      client_id: "client-1",
      scope: "openid email",
    });

    const response = await POST(
      makeRequest({
        oauth_query: oauthQuery,
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
    const oauthQuery = await makeSignedOAuthQuery({
      client_id: "client-1",
      scope: scopes.join(" "),
    });

    const response = await POST(
      makeRequest({
        oauth_query: oauthQuery,
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
