import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DpopKeyPair } from "../../src/auth/dpop.js";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

const {
  mockCreateDpopClientFromKeyPair,
  mockDiscover,
  mockEnsureFirstPartyAuth,
  mockExchangeAuthorizationCode,
  mockGetOrCreateDpopClient,
  mockSdkExchangeToken,
  mockSdkResolveOAuthIdentity,
} = vi.hoisted(() => ({
  mockCreateDpopClientFromKeyPair: vi.fn(),
  mockDiscover: vi.fn(),
  mockEnsureFirstPartyAuth: vi.fn(),
  mockExchangeAuthorizationCode: vi.fn(),
  mockGetOrCreateDpopClient: vi.fn(),
  mockSdkExchangeToken: vi.fn(),
  mockSdkResolveOAuthIdentity: vi.fn(),
}));

vi.mock("@zentity/sdk/rp", () => ({
  createDpopClientFromKeyPair: mockCreateDpopClientFromKeyPair,
}));

vi.mock("@zentity/sdk/fpa", () => ({
  exchangeToken: mockSdkExchangeToken,
  resolveOAuthIdentity: mockSdkResolveOAuthIdentity,
}));

vi.mock("../../src/auth/first-party-auth.js", () => ({
  ensureFirstPartyAuth: mockEnsureFirstPartyAuth,
}));

import {
  exchangeAuthCode,
  exchangeToken,
  resolveOAuthIdentity,
} from "../../src/auth/token-exchange.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

describe("token-exchange adapters", () => {
  beforeEach(() => {
    mockCreateDpopClientFromKeyPair.mockReset();
    mockDiscover.mockReset();
    mockEnsureFirstPartyAuth.mockReset();
    mockExchangeAuthorizationCode.mockReset();
    mockGetOrCreateDpopClient.mockReset();
    mockSdkExchangeToken.mockReset();
    mockSdkResolveOAuthIdentity.mockReset();
    mockEnsureFirstPartyAuth.mockReturnValue({
      discover: mockDiscover,
      exchangeAuthorizationCode: mockExchangeAuthorizationCode,
      getOrCreateDpopClient: mockGetOrCreateDpopClient,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates authorization-code exchange to the shared first-party auth client", async () => {
    mockExchangeAuthorizationCode.mockResolvedValue({
      accessToken: "at_123",
      expiresAt: Date.now() + 3_600_000,
      loginHint: "user@example.com",
      refreshToken: "rt_456",
      scopes: ["openid"],
    });

    const result = await exchangeAuthCode(
      "http://localhost:3000/api/auth/oauth2/token",
      "code_abc",
      "verifier_xyz",
      "client-1",
      "http://127.0.0.1/callback",
      mockDpopKey
    );

    expect(result.accessToken).toBe("at_123");
    expect(mockExchangeAuthorizationCode).toHaveBeenCalledWith({
      clientId: "client-1",
      code: "code_abc",
      codeVerifier: "verifier_xyz",
      redirectUri: "http://127.0.0.1/callback",
    });
  });

  it("delegates token exchange to the SDK helper with the shared DPoP client", async () => {
    mockDiscover.mockResolvedValue({
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
    });
    mockGetOrCreateDpopClient.mockResolvedValue("mock-dpop-client");
    mockSdkExchangeToken.mockResolvedValue({
      accessToken: "merchant-token",
      expiresIn: 1800,
      scope: "openid purchase",
      tokenType: "DPoP",
    });

    const result = await exchangeToken({
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      subjectToken: "ciba-access-token",
      audience: "https://merchant.example.com",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      scope: "purchase",
    });

    expect(result.accessToken).toBe("merchant-token");
    expect(mockSdkExchangeToken).toHaveBeenCalledWith({
      audience: "https://merchant.example.com",
      clientId: "client-1",
      dpopClient: "mock-dpop-client",
      scope: "purchase",
      subjectToken: "ciba-access-token",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
    });
  });

  it("delegates identity resolution to the SDK helper with a DPoP client built from the provided key", async () => {
    mockCreateDpopClientFromKeyPair.mockResolvedValue("derived-dpop-client");
    mockSdkResolveOAuthIdentity.mockResolvedValue({
      accountSub: "pairwise-subject",
      loginHint: "user@example.com",
    });

    const result = await resolveOAuthIdentity(
      "access-token",
      mockDpopKey,
      "id-token"
    );

    expect(result).toEqual({
      accountSub: "pairwise-subject",
      loginHint: "user@example.com",
    });
    expect(mockCreateDpopClientFromKeyPair).toHaveBeenCalledWith(mockDpopKey);
    expect(mockSdkResolveOAuthIdentity).toHaveBeenCalledWith(
      "http://localhost:3000",
      "access-token",
      "derived-dpop-client",
      "id-token"
    );
  });

  it("surfaces shared-client failures unchanged", async () => {
    mockExchangeAuthorizationCode.mockRejectedValue(
      new Error("Token exchange failed: 400 invalid_grant")
    );

    await expect(
      exchangeAuthCode(
        "http://localhost:3000/api/auth/oauth2/token",
        "bad_code",
        "verifier_xyz",
        "client-1",
        "http://127.0.0.1/callback",
        mockDpopKey
      )
    ).rejects.toThrow("Token exchange failed: 400");
  });
});
