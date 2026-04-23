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

const { mockEnsureFirstPartyAuth, mockGetAccessToken } = vi.hoisted(() => ({
  mockEnsureFirstPartyAuth: vi.fn(),
  mockGetAccessToken: vi.fn(),
}));

vi.mock("../../src/auth/first-party-auth.js", () => ({
  ensureFirstPartyAuth: mockEnsureFirstPartyAuth,
}));

import {
  AccessTokenProvider,
  TokenExpiredError,
} from "../../src/auth/access-token-provider.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const TOKEN_ENDPOINT = "http://localhost:3000/api/auth/oauth2/token";

describe("AccessTokenProvider", () => {
  let accessTokenProvider: AccessTokenProvider;

  beforeEach(() => {
    mockEnsureFirstPartyAuth.mockReset();
    mockGetAccessToken.mockReset();
    mockEnsureFirstPartyAuth.mockReturnValue({
      getAccessToken: mockGetAccessToken,
    });
    accessTokenProvider = new AccessTokenProvider(
      TOKEN_ENDPOINT,
      mockDpopKey,
      "test-client"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates access-token refresh to the shared first-party auth client", async () => {
    mockGetAccessToken.mockResolvedValue("fresh-access-token");

    await expect(accessTokenProvider.getAccessToken()).resolves.toBe(
      "fresh-access-token"
    );
    expect(mockGetAccessToken).toHaveBeenCalledWith({
      clientId: "test-client",
    });
  });

  it("passes the app resource through when configured", async () => {
    mockGetAccessToken.mockResolvedValue("resource-token");
    accessTokenProvider = new AccessTokenProvider(
      TOKEN_ENDPOINT,
      mockDpopKey,
      "test-client",
      "http://localhost:3000"
    );

    await accessTokenProvider.getAccessToken();

    expect(mockGetAccessToken).toHaveBeenCalledWith({
      clientId: "test-client",
      resource: "http://localhost:3000",
    });
  });

  it("surfaces token-expired failures from the shared client", async () => {
    mockGetAccessToken.mockRejectedValue(new TokenExpiredError());

    await expect(accessTokenProvider.getAccessToken()).rejects.toThrow(
      TokenExpiredError
    );
  });
});
