import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDiscoverAgentConfiguration, mockExchangeMcpLoginToken } =
  vi.hoisted(() => ({
    mockDiscoverAgentConfiguration: vi.fn(),
    mockExchangeMcpLoginToken: vi.fn(),
  }));

vi.mock("../../src/config.js", () => ({
  config: { zentityUrl: "http://localhost:3000" },
}));

vi.mock("../../src/oauth-client.js", () => ({
  exchangeMcpLoginToken: mockExchangeMcpLoginToken,
}));

vi.mock("../../src/runtime/agent-configuration.js", () => ({
  discoverAgentConfiguration: mockDiscoverAgentConfiguration,
}));

import { prepareBootstrapRegistrationAuth } from "../../src/runtime/agent-registration.js";
import type { OAuthSessionContext } from "../../src/runtime/auth-context.js";

const sessionAuth = {
  accessToken: "login-token",
  accountSub: "user-123",
  clientId: "mcp-client",
  dpopClient: {},
  dpopKey: {
    privateJwk: { crv: "P-256", kty: "EC" },
    publicJwk: { crv: "P-256", kty: "EC" },
  },
  scopes: [
    "openid",
    "email",
    "offline_access",
    "proof:identity",
    "agent:host.register",
    "agent:session.register",
    "agent:session.revoke",
  ],
} as unknown as OAuthSessionContext;

describe("prepareBootstrapRegistrationAuth", () => {
  beforeEach(() => {
    mockDiscoverAgentConfiguration.mockResolvedValue({
      bootstrap_token_exchange: {
        audience: "http://localhost:3000",
        scopes_supported: [
          "agent:host.register",
          "agent:session.register",
          "agent:session.revoke",
        ],
      },
    });
    mockExchangeMcpLoginToken.mockResolvedValue("bootstrap-token");
  });

  it("exchanges the stored login token for the advertised bootstrap scopes", async () => {
    const bootstrapAuth = await prepareBootstrapRegistrationAuth(sessionAuth);

    expect(mockExchangeMcpLoginToken).toHaveBeenCalledWith({
      audience: "http://localhost:3000",
      scope: "agent:host.register agent:session.register agent:session.revoke",
    });
    expect(bootstrapAuth).toEqual({
      ...sessionAuth,
      accessToken: "bootstrap-token",
    });
  });
});
