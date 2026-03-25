import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAuth = vi.fn();
const mockZentityFetch = vi.fn();

vi.mock("../../src/auth/context.js", () => ({
  getOAuthContext: (ctx: { oauth: { scopes: string[] } }) => ctx.oauth,
  requireAuth: () => mockRequireAuth(),
}));

vi.mock("../../src/auth/api-client.js", () => ({
  zentityFetch: (...args: unknown[]) => mockZentityFetch(...args),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
  },
}));

import { fetchAccountSummary } from "../../src/services/account-summary.js";

describe("fetchAccountSummary", () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockZentityFetch.mockReset();
  });

  it("returns account email when the granted scopes include email", async () => {
    mockRequireAuth.mockResolvedValue({
      oauth: { scopes: ["openid", "email"] },
    });
    mockZentityFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              data: {
                authStrength: "strong",
                details: { document: true },
                loginMethod: "passkey",
                tier: 2,
                tierName: "Verified",
              },
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              data: {
                createdAt: "2026-01-01",
                email: "user@example.com",
                verification: {
                  level: "full",
                  checks: { document: true },
                },
              },
            },
          }),
          { status: 200 }
        )
      );

    const summary = await fetchAccountSummary();

    expect(summary.email).toBe("user@example.com");
    expect(summary.vaultFieldsAvailable).toEqual([
      "name",
      "address",
      "birthdate",
    ]);
  });

  it("suppresses account email when the granted scopes do not include email", async () => {
    mockRequireAuth.mockResolvedValue({
      oauth: { scopes: ["openid"] },
    });
    mockZentityFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              data: {
                authStrength: "strong",
                details: { document: true },
                loginMethod: "passkey",
                tier: 2,
                tierName: "Verified",
              },
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              data: {
                createdAt: "2026-01-01",
                email: "user@example.com",
                verification: {
                  level: "full",
                  checks: { document: true },
                },
              },
            },
          }),
          { status: 200 }
        )
      );

    const summary = await fetchAccountSummary();

    expect(summary.email).toBeNull();
    expect(summary.vaultFieldsAvailable).toEqual([
      "name",
      "address",
      "birthdate",
    ]);
  });
});
