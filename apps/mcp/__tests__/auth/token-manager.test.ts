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

const credentialsMock: {
  stored: Record<string, unknown> | undefined;
} = { stored: undefined };

vi.mock("../../src/auth/credentials.js", () => ({
  loadCredentials: vi.fn(() => credentialsMock.stored),
  updateCredentials: vi.fn((_url: string, updates: Record<string, unknown>) => {
    credentialsMock.stored = { ...credentialsMock.stored, ...updates };
    return credentialsMock.stored;
  }),
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

import { updateCredentials } from "../../src/auth/credentials.js";
import { extractDpopNonce } from "../../src/auth/dpop.js";
import {
  TokenExpiredError,
  TokenManager,
} from "../../src/auth/token-manager.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const TOKEN_ENDPOINT = "http://localhost:3000/api/auth/oauth2/token";

describe("TokenManager", () => {
  let manager: TokenManager;

  beforeEach(() => {
    credentialsMock.stored = undefined;
    manager = new TokenManager(TOKEN_ENDPOINT, mockDpopKey, "test-client");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached access token when not expired", async () => {
    credentialsMock.stored = {
      accessToken: "valid-token",
      expiresAt: Date.now() + 300_000,
      zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
      clientId: "test-client",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const token = await manager.getAccessToken();
    expect(token).toBe("valid-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes token when expiring within 60s", async () => {
    credentialsMock.stored = {
      accessToken: "old-token",
      expiresAt: Date.now() + 30_000,
      refreshToken: "refresh-abc",
      zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
      clientId: "test-client",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "new-token",
          expires_in: 3600,
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    const token = await manager.getAccessToken();
    expect(token).toBe("new-token");
    expect(updateCredentials).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.objectContaining({
        accessToken: "new-token",
        refreshToken: "refresh-abc",
      })
    );
  });

  it("preserves existing refresh token when AS does not rotate", async () => {
    credentialsMock.stored = {
      accessToken: "old-token",
      expiresAt: Date.now() - 1000,
      refreshToken: "original-refresh",
      zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
      clientId: "test-client",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "refreshed-token",
          expires_in: 3600,
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    await manager.getAccessToken();
    expect(updateCredentials).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.objectContaining({ refreshToken: "original-refresh" })
    );
  });

  it("stores rotated refresh token when AS provides one", async () => {
    credentialsMock.stored = {
      accessToken: "old-token",
      expiresAt: Date.now() - 1000,
      refreshToken: "original-refresh",
      zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
      clientId: "test-client",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "refreshed-token",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    await manager.getAccessToken();
    expect(updateCredentials).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.objectContaining({ refreshToken: "rotated-refresh" })
    );
  });

  it("clears credentials and throws on invalid_grant", async () => {
    credentialsMock.stored = {
      accessToken: "old-token",
      expiresAt: Date.now() - 1000,
      refreshToken: "bad-refresh",
      zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
      clientId: "test-client",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
    );

    await expect(manager.getAccessToken()).rejects.toThrow(TokenExpiredError);
    expect(updateCredentials).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.objectContaining({
        accessToken: undefined,
        refreshToken: undefined,
      })
    );
  });

  it("throws TokenExpiredError when no credentials exist", () => {
    credentialsMock.stored = undefined;
    expect(() => manager.getAccessToken()).toThrow(TokenExpiredError);
  });

  it("retries with new DPoP nonce on 401", async () => {
    credentialsMock.stored = {
      accessToken: "old-token",
      expiresAt: Date.now() - 1000,
      refreshToken: "good-refresh",
      zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
      clientId: "test-client",
    };

    vi.mocked(extractDpopNonce)
      .mockReturnValueOnce("server-nonce-1")
      .mockReturnValueOnce("server-nonce-1");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
          status: 401,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "nonce-token",
            expires_in: 3600,
            token_type: "DPoP",
          }),
          { status: 200 }
        )
      );

    const token = await manager.getAccessToken();
    expect(token).toBe("nonce-token");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
