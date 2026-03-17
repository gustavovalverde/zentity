import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/auth/credentials.js", () => ({
  loadCredentials: vi.fn(),
  updateCredentials: vi.fn(),
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

const { mockRunFpaFlow } = vi.hoisted(() => ({
  mockRunFpaFlow: vi.fn(),
}));

vi.mock("../../src/auth/fpa.js", () => ({
  runFpaFlow: mockRunFpaFlow,
  RedirectToWebError: class RedirectToWebError extends Error {
    authSession: string;
    constructor(authSession: string) {
      super("Redirect to web");
      this.name = "RedirectToWebError";
      this.authSession = authSession;
    }
  },
}));

vi.mock("../../src/auth/pkce.js", () => ({
  generatePkce: () =>
    Promise.resolve({
      codeVerifier: "test-verifier",
      codeChallenge: "test-challenge",
      codeChallengeMethod: "S256",
    }),
}));

const { mockExchangeAuthCode } = vi.hoisted(() => ({
  mockExchangeAuthCode: vi.fn(),
}));

vi.mock("../../src/auth/token-exchange.js", () => ({
  exchangeAuthCode: mockExchangeAuthCode,
}));

import { loadCredentials } from "../../src/auth/credentials.js";
import { RedirectToWebError } from "../../src/auth/fpa.js";
import {
  detectStepUp,
  performStepUp,
  StepUpRequiredError,
} from "../../src/auth/step-up.js";

const mockDpopKey = {
  privateJwk: { kty: "EC" as const, crv: "P-256" },
  publicJwk: { kty: "EC" as const, crv: "P-256" },
};

describe("detectStepUp", () => {
  it("throws StepUpRequiredError on 403 with insufficient_authorization", () => {
    const body = JSON.stringify({
      error: "insufficient_authorization",
      auth_session: "session-abc",
      acr_values: "urn:zentity:acr:tier2",
    });

    expect(() => detectStepUp(403, body)).toThrow(StepUpRequiredError);
  });

  it("includes acr_values in the error", () => {
    const body = JSON.stringify({
      error: "insufficient_authorization",
      auth_session: "session-abc",
      acr_values: "urn:zentity:acr:tier2",
    });

    try {
      detectStepUp(403, body);
    } catch (error) {
      expect(error).toBeInstanceOf(StepUpRequiredError);
      expect((error as StepUpRequiredError).authSession).toBe("session-abc");
      expect((error as StepUpRequiredError).acrValues).toBe(
        "urn:zentity:acr:tier2"
      );
    }
  });

  it("does nothing for non-403 status", () => {
    const body = JSON.stringify({
      error: "insufficient_authorization",
      auth_session: "session-abc",
    });

    expect(() => detectStepUp(400, body)).not.toThrow();
  });

  it("does nothing when error is not insufficient_authorization", () => {
    const body = JSON.stringify({
      error: "invalid_grant",
      auth_session: "session-abc",
    });

    expect(() => detectStepUp(403, body)).not.toThrow();
  });

  it("does nothing when auth_session is missing", () => {
    const body = JSON.stringify({
      error: "insufficient_authorization",
    });

    expect(() => detectStepUp(403, body)).not.toThrow();
  });

  it("does nothing on unparseable body", () => {
    expect(() => detectStepUp(403, "not json")).not.toThrow();
  });
});

describe("performStepUp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockRunFpaFlow.mockReset();
    mockExchangeAuthCode.mockReset();
  });

  function makeStepUpParams(getPassword = () => Promise.resolve("secret")) {
    return {
      challengeEndpoint: "http://localhost:3000/api/oauth2/authorize-challenge",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
      clientId: "client-1",
      dpopKey: mockDpopKey,
      redirectUri: "http://127.0.0.1/callback",
      getPassword,
    };
  }

  it("re-authenticates via FPA and returns new access token", async () => {
    vi.mocked(loadCredentials).mockReturnValue({
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "client-1",
      loginHint: "user@test.com",
    });

    mockRunFpaFlow.mockResolvedValue({
      authorizationCode: "new-code",
      authSession: "new-session",
      exportKey: "export-key",
    });

    mockExchangeAuthCode.mockResolvedValue({
      accessToken: "stepped-up-token",
      expiresAt: Date.now() + 3_600_000,
    });

    const params = makeStepUpParams();
    const stepUpError = new StepUpRequiredError("old-session", "tier2");
    const token = await performStepUp(stepUpError, params);

    expect(token).toBe("stepped-up-token");
    expect(mockRunFpaFlow).toHaveBeenCalledWith(
      params.challengeEndpoint,
      params.clientId,
      expect.objectContaining({ codeVerifier: "test-verifier" }),
      params.dpopKey,
      "user@test.com",
      "secret",
      undefined
    );
  });

  it("throws if no stored credentials", async () => {
    vi.mocked(loadCredentials).mockReturnValue(undefined);

    const stepUpError = new StepUpRequiredError("session");
    await expect(
      performStepUp(stepUpError, makeStepUpParams())
    ).rejects.toThrow("Cannot step up — no stored user identity");
  });

  it("throws readable error on passkey redirect", async () => {
    vi.mocked(loadCredentials).mockReturnValue({
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "client-1",
      loginHint: "user@test.com",
    });

    mockRunFpaFlow.mockRejectedValue(new RedirectToWebError("redir-session"));

    const stepUpError = new StepUpRequiredError("session");
    await expect(
      performStepUp(stepUpError, makeStepUpParams())
    ).rejects.toThrow("browser redirect not supported in step-up flow");
  });
});
