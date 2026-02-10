import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEphemeralIdentityClaimsStore } from "@/lib/auth/oidc/ephemeral-identity-claims";
import { createIdentityIntentToken } from "@/lib/auth/oidc/identity-intent";

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
  return new Request("http://localhost/api/oauth2/identity/stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("oauth2 identity stage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
    authMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    resetEphemeralIdentityClaimsStore();
  });

  it("requires intent_token when identity scopes are requested", async () => {
    const scopes = ["openid", "identity.name"];
    const oauthQuery = await makeSignedOAuthQuery({
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
    const oauthQuery = await makeSignedOAuthQuery({
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
    const oauthQuery = await makeSignedOAuthQuery({
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
    const oauthQuery = await makeSignedOAuthQuery({
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

    const second = await POST(makeRequest(body));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: "Identity intent token has already been used",
    });
  });

  it("rejects concurrent staged flows for the same user", async () => {
    const scopes = ["openid", "identity.name"];
    const oauthQuery = await makeSignedOAuthQuery({
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
      error: "An active identity stage already exists for this user",
    });
  });
});
