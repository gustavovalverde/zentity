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
  it("is granted the bootstrap scopes at login but keeps them off its session token", async () => {
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
    const sessionScopes = readScopes(options.tokenExchangeScope);
    const registeredScopes = readScopes(
      options.clientRegistrationRequest.scope
    );

    expect(loginScopes).toEqual(expect.arrayContaining(AGENT_BOOTSTRAP_SCOPES));
    expect(registeredScopes).toEqual(expect.arrayContaining(loginScopes));
    expect(sessionScopes).toContain("openid");
    expect(loginScopes).toEqual(expect.arrayContaining(sessionScopes));
    for (const scope of [...AGENT_BOOTSTRAP_SCOPES, "offline_access"]) {
      expect(sessionScopes).not.toContain(scope);
    }
    expect(mockExchangeLoginToken).toHaveBeenCalledWith({
      audience: "http://localhost:3000",
      scope: AGENT_BOOTSTRAP_SCOPES.join(" "),
    });
  });
});
