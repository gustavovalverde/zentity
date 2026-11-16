import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";
import { describe, expect, it, vi } from "vitest";

const { mockCreateInstalledClientAuth, mockExchangeLoginToken } = vi.hoisted(
  () => ({
    mockCreateInstalledClientAuth: vi.fn(),
    mockExchangeLoginToken: vi.fn(),
  })
);

vi.mock("../src/config.js", () => ({
  config: {
    mcpPublicUrl: "http://localhost:3300",
    openBrowser: true,
    zentityUrl: "http://localhost:3000",
  },
}));

vi.mock("@zentity/sdk/node", async () => {
  const actual =
    await vi.importActual<typeof import("@zentity/sdk/node")>(
      "@zentity/sdk/node"
    );
  return {
    ...actual,
    createFirstPartyAuthFileStorage: vi.fn(() => ({
      load: vi.fn(),
      save: vi.fn(),
    })),
    createInstalledClientAuth: mockCreateInstalledClientAuth,
  };
});

import { exchangeMcpLoginToken } from "../src/oauth-client.js";

function readScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(" ") : [];
}

describe("MCP installed client", () => {
  it("requests the bootstrap scopes at login and exchanges the login token for them", async () => {
    mockExchangeLoginToken.mockResolvedValue({
      accessToken: "bootstrap-token",
      expiresIn: 3600,
      tokenType: "DPoP",
    });
    mockCreateInstalledClientAuth.mockReturnValue({
      exchangeLoginToken: mockExchangeLoginToken,
    });

    await expect(
      exchangeMcpLoginToken({
        audience: "http://localhost:3000",
        scope: AGENT_BOOTSTRAP_SCOPES.join(" "),
      })
    ).resolves.toBe("bootstrap-token");

    const [options] = mockCreateInstalledClientAuth.mock.calls[0] ?? [];
    const loginScopes = readScopes(options.loginScope);
    const registeredScopes = readScopes(
      options.clientRegistrationRequest.scope
    );

    expect(loginScopes).toEqual(expect.arrayContaining(AGENT_BOOTSTRAP_SCOPES));
    expect(loginScopes).toContain("openid");
    expect(registeredScopes).toEqual(expect.arrayContaining(loginScopes));
    // The login token is the session: no session exchange narrows it.
    expect(options).not.toHaveProperty("tokenExchangeAudience");
    expect(options).not.toHaveProperty("tokenExchangeScope");
    expect(mockExchangeLoginToken).toHaveBeenCalledWith({
      audience: "http://localhost:3000",
      scope: AGENT_BOOTSTRAP_SCOPES.join(" "),
    });
  });
});
