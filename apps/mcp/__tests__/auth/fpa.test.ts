import { afterEach, describe, expect, it, vi } from "vitest";
import type { DpopKeyPair } from "../../src/auth/dpop.js";
import type { PkceChallenge } from "../../src/auth/pkce.js";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/auth/credentials.js", () => ({
  updateCredentials: vi.fn(),
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/auth/opaque-client.js", () => ({
  ensureReady: vi.fn().mockResolvedValue(undefined),
  startLogin: vi.fn(),
  finishLogin: vi.fn(),
}));

import { RedirectToWebError, runFpaFlow } from "../../src/auth/fpa.js";
import { finishLogin, startLogin } from "../../src/auth/opaque-client.js";

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

describe("FPA State Machine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes the 3-round OPAQUE flow", async () => {
    vi.mocked(startLogin).mockReturnValue({
      clientLoginState: "mock-client-state",
      startLoginRequest: "mock-start-request",
    });
    vi.mocked(finishLogin).mockReturnValue({
      finishLoginRequest: "mock-finish-request",
      exportKey: "mock-export-key",
      serverStaticPublicKey: "mock-server-pk",
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "insufficient_authorization",
            auth_session: "session-abc",
            challenge_type: "opaque",
            server_public_key: "pk123",
          }),
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            opaque_login_response: "server-response-data",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization_code: "code_xyz" }), {
          status: 200,
        })
      );

    const result = await runFpaFlow(
      CHALLENGE_URL,
      "client-1",
      mockPkce,
      mockDpopKey,
      "user@example.com",
      "password123"
    );

    expect(result.authorizationCode).toBe("code_xyz");
    expect(result.authSession).toBe("session-abc");
    expect(result.exportKey).toBe("mock-export-key");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws RedirectToWebError for passkey-only users", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "insufficient_authorization",
          auth_session: "session-passkey",
          challenge_type: "redirect_to_web",
        }),
        { status: 401 }
      )
    );

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

  it("throws on unsupported challenge type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "insufficient_authorization",
          auth_session: "session-x",
          challenge_type: "unknown_method",
        }),
        { status: 401 }
      )
    );

    await expect(
      runFpaFlow(
        CHALLENGE_URL,
        "client-1",
        mockPkce,
        mockDpopKey,
        "user@example.com",
        "password"
      )
    ).rejects.toThrow("Unsupported challenge type: unknown_method");
  });

  it("throws when round 1 returns unexpected status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server error", { status: 500 })
    );

    await expect(
      runFpaFlow(
        CHALLENGE_URL,
        "client-1",
        mockPkce,
        mockDpopKey,
        "user@example.com",
        "password"
      )
    ).rejects.toThrow("Expected 401 from challenge endpoint: 500");
  });
});
