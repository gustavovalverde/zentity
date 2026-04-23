import { afterEach, describe, expect, it, vi } from "vitest";
import type { DpopClient } from "../rp/dpop-client";

const { mockFetchUserInfo } = vi.hoisted(() => ({
  mockFetchUserInfo: vi.fn(),
}));

vi.mock("../rp/userinfo", () => ({
  fetchUserInfo: mockFetchUserInfo,
}));

import { exchangeAuthorizationCode, exchangeToken } from "./oauth";

function createMockDpopClient(): DpopClient {
  return {
    keyPair: {
      privateJwk: {
        crv: "P-256",
        d: "private",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
      publicJwk: {
        crv: "P-256",
        kty: "EC",
        x: "pub-x",
        y: "pub-y",
      },
    },
    proofFor: vi.fn().mockResolvedValue("mock-proof"),
    async withNonceRetry<T>(
      attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
    ) {
      return attempt();
    },
  };
}

function encodeJwtSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("oauth helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockFetchUserInfo.mockReset();
  });

  it("exchanges an authorization code and resolves the account identity", async () => {
    mockFetchUserInfo.mockResolvedValue({
      email: "user@example.com",
      sub: "pairwise-subject",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 1800,
          refresh_token: "refresh-token",
          scope: "openid offline_access identity.name",
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    const dpopClient = createMockDpopClient();
    const result = await exchangeAuthorizationCode("https://issuer.example", {
      clientId: "client-123",
      code: "code-123",
      codeVerifier: "verifier-123",
      dpopClient,
      redirectUri: "http://127.0.0.1/callback",
      resource: "https://resource.example",
      tokenEndpoint: "https://issuer.example/oauth/token",
    });

    expect(result).toEqual(
      expect.objectContaining({
        accessToken: "access-token",
        accountSub: "pairwise-subject",
        loginHint: "user@example.com",
        refreshToken: "refresh-token",
        scopes: ["openid", "offline_access", "identity.name"],
      })
    );
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall).toBeDefined();
    const [, init] = fetchCall!;
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-123");
    expect(body.get("code_verifier")).toBe("verifier-123");
    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("resource")).toBe("https://resource.example");
  });

  it("extracts downstream identity hints from an exchanged app token", async () => {
    const accessToken = `${encodeJwtSegment({ alg: "none" })}.${encodeJwtSegment({
      sub: "pairwise-subject",
      zentity_login_hint: "user-123",
    })}.`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          scope: "purchase",
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    const result = await exchangeToken({
      audience: "https://merchant.example.com",
      clientId: "client-123",
      dpopClient: createMockDpopClient(),
      scope: "purchase",
      subjectToken: "subject-token",
      tokenEndpoint: "https://issuer.example/oauth/token",
    });

    expect(result).toEqual({
      accessToken,
      accountSub: "pairwise-subject",
      expiresIn: 3600,
      loginHint: "user-123",
      scope: "purchase",
      tokenType: "DPoP",
    });
  });

  it("throws when the token endpoint rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 })
    );

    await expect(
      exchangeToken({
        audience: "https://merchant.example.com",
        clientId: "client-123",
        dpopClient: createMockDpopClient(),
        subjectToken: "subject-token",
        tokenEndpoint: "https://issuer.example/oauth/token",
      })
    ).rejects.toThrow("Token exchange failed: 400");
  });
});
