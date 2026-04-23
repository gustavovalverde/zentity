import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DpopKeyPair } from "../../src/auth/dpop.js";
import type { PkceChallenge } from "../../src/auth/pkce.js";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

const { mockAuthorize, mockEnsureFirstPartyAuth } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockEnsureFirstPartyAuth: vi.fn(),
}));

vi.mock("../../src/auth/first-party-auth.js", () => ({
  ensureFirstPartyAuth: mockEnsureFirstPartyAuth,
}));

import {
  RedirectToWebError,
  runFpaFlow,
  runFpaFlowWithRetries,
} from "../../src/auth/fpa.js";

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

const mockPkce: PkceChallenge = {
  codeChallenge: "challenge123",
  codeChallengeMethod: "S256",
  codeVerifier: "verifier123",
};

const CHALLENGE_URL = "http://localhost:3000/api/oauth2/authorize-challenge";

describe("FPA adapter", () => {
  beforeEach(() => {
    mockAuthorize.mockReset();
    mockEnsureFirstPartyAuth.mockReset();
    mockEnsureFirstPartyAuth.mockReturnValue({
      authorize: mockAuthorize,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates password authorization to the shared first-party auth client", async () => {
    mockAuthorize.mockResolvedValue({
      authorizationCode: "code_xyz",
      authSession: "session-abc",
      exportKey: "mock-export-key",
      loginMethod: "opaque",
    });

    const result = await runFpaFlow(
      CHALLENGE_URL,
      "client-1",
      mockPkce,
      mockDpopKey,
      "user@example.com",
      "password123"
    );

    expect(result).toEqual({
      authorizationCode: "code_xyz",
      authSession: "session-abc",
      exportKey: "mock-export-key",
    });
    expect(mockAuthorize).toHaveBeenCalledWith({
      clientId: "client-1",
      identifier: "user@example.com",
      pkce: mockPkce,
      scope: expect.stringContaining("openid"),
      strategies: {
        password: {
          password: "password123",
        },
      },
    });
  });

  it("propagates passkey redirect requirements", async () => {
    mockAuthorize.mockRejectedValue(new RedirectToWebError("session-passkey"));

    await expect(
      runFpaFlow(
        CHALLENGE_URL,
        "client-1",
        mockPkce,
        mockDpopKey,
        "passkey@example.com",
        "password"
      )
    ).rejects.toThrow(RedirectToWebError);
  });

  it("fails when the shared client does not return an OPAQUE export key", async () => {
    mockAuthorize.mockResolvedValue({
      authorizationCode: "wallet-code",
      authSession: "wallet-session",
      loginMethod: "eip712",
    });

    await expect(
      runFpaFlow(
        CHALLENGE_URL,
        "client-1",
        mockPkce,
        mockDpopKey,
        "user@example.com",
        "password"
      )
    ).rejects.toThrow("OPAQUE authorization response missing exportKey");
  });

  it("retries transient failures before succeeding", async () => {
    mockEnsureFirstPartyAuth.mockReturnValue({
      authorize: mockAuthorize,
    });
    mockAuthorize
      .mockRejectedValueOnce(new Error("invalid credentials"))
      .mockResolvedValueOnce({
        authorizationCode: "code-2",
        authSession: "session-2",
        exportKey: "export-key-2",
        loginMethod: "opaque",
      });

    const getCredentials = vi
      .fn<() => Promise<{ email: string; password: string }>>()
      .mockResolvedValue({
        email: "user@example.com",
        password: "password123",
      });

    const result = await runFpaFlowWithRetries(
      CHALLENGE_URL,
      "client-1",
      mockPkce,
      mockDpopKey,
      getCredentials
    );

    expect(result.authorizationCode).toBe("code-2");
    expect(getCredentials).toHaveBeenCalledTimes(2);
  });
});
