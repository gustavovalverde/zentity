import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

const { mockEnsureFirstPartyAuth, mockStepUp } = vi.hoisted(() => ({
  mockEnsureFirstPartyAuth: vi.fn(),
  mockStepUp: vi.fn(),
}));

vi.mock("../../src/auth/first-party-auth.js", () => ({
  ensureFirstPartyAuth: mockEnsureFirstPartyAuth,
}));

import { loadCredentials } from "../../src/auth/credentials.js";
import { RedirectToWebError } from "../../src/auth/fpa.js";
import {
  completeStepUp,
  detectStepUp,
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

  it("ignores unrelated responses", () => {
    expect(() =>
      detectStepUp(
        403,
        JSON.stringify({
          error: "invalid_grant",
        })
      )
    ).not.toThrow();
  });
});

describe("completeStepUp", () => {
  beforeEach(() => {
    mockEnsureFirstPartyAuth.mockReset();
    mockStepUp.mockReset();
    mockEnsureFirstPartyAuth.mockReturnValue({
      stepUp: mockStepUp,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("re-authenticates through the shared first-party auth client", async () => {
    vi.mocked(loadCredentials).mockReturnValue({
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "client-1",
      loginHint: "user@test.com",
    });
    mockStepUp.mockResolvedValue({
      accessToken: "stepped-up-token",
      authSession: "new-session",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
    });

    const params = makeStepUpParams();
    const stepUpError = new StepUpRequiredError("old-session", "tier2");
    const token = await completeStepUp(stepUpError, params);

    expect(token).toBe("stepped-up-token");
    expect(mockStepUp).toHaveBeenCalledWith({
      authSession: "old-session",
      clientId: "client-1",
      redirectUri: "http://127.0.0.1/callback",
      strategies: {
        password: {
          password: "secret",
        },
      },
    });
  });

  it("throws if no stored credentials are available", async () => {
    vi.mocked(loadCredentials).mockReturnValue(undefined);

    const stepUpError = new StepUpRequiredError("session");
    await expect(
      completeStepUp(stepUpError, makeStepUpParams())
    ).rejects.toThrow("Cannot step up — no stored user identity");
  });

  it("throws a readable error when step-up requires a browser redirect", async () => {
    vi.mocked(loadCredentials).mockReturnValue({
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "client-1",
      loginHint: "user@test.com",
    });
    mockStepUp.mockRejectedValue(new RedirectToWebError("redir-session"));

    const stepUpError = new StepUpRequiredError("session");
    await expect(
      completeStepUp(stepUpError, makeStepUpParams())
    ).rejects.toThrow("browser redirect not supported in step-up flow");
  });
});
