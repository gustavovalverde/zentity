import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAuth = vi.fn();
const mockZentityFetch = vi.fn();

vi.mock("../../src/runtime/auth-context.js", () => ({
  getOAuthContext: (ctx: { oauth: { scopes: string[] } }) => ctx.oauth,
  requireAuth: () => mockRequireAuth(),
}));

vi.mock("../../src/services/zentity-api.js", () => ({
  zentityFetch: (...args: unknown[]) => mockZentityFetch(...args),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
  },
}));

import type { SecurityPosture } from "@zentity/sdk/protocol";
import { fetchAccountSummary } from "../../src/services/account-summary.js";

const SECURITY_POSTURE: SecurityPosture = {
  assurance: {
    tier: 2,
    tierName: "Verified",
    details: {
      chipVerified: false,
      documentVerified: true,
      faceMatchVerified: true,
      fheComplete: true,
      hasIncompleteProofs: false,
      hasSecuredKeys: true,
      isAuthenticated: true,
      livenessVerified: true,
      missingProfileSecret: false,
      needsDocumentReprocessing: false,
      onChainAttested: false,
      zkProofsComplete: true,
    },
  },
  auth: {
    amr: ["pop", "hwk"],
    authenticatedAt: 1_767_225_600,
    authStrength: "strong",
    id: "auth-context-1",
    loginMethod: "passkey",
    sourceKind: "token_exchange",
  },
  capabilities: {
    hasOpaqueAccount: false,
    hasPasskeys: true,
    hasWalletAuth: false,
  },
};

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
              data: SECURITY_POSTURE,
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
    expect(summary).toMatchObject({
      tier: 2,
      tierName: "Verified",
      authStrength: "strong",
      loginMethod: "passkey",
    });
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
              data: SECURITY_POSTURE,
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
