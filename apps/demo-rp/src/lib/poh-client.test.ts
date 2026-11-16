import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountRow: undefined as
    | {
        accessToken: string | null;
        accessTokenExpiresAt?: Date | null;
        accountId?: string | null;
      }
    | undefined,
  dpopClient: { keyPair: {} },
  getSession: vi.fn(),
  requestProofOfHumanToken: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
}));

vi.mock("@/lib/db/connection", () => {
  const query = {
    from: () => query,
    get: async () => mocks.accountRow,
    limit: () => query,
    where: () => query,
  };
  return { getDb: () => ({ select: () => query }) };
});

vi.mock("@/lib/env", () => ({
  env: { ZENTITY_URL: "http://zentity.example" },
}));

vi.mock("@/lib/oauth-dpop-client", () => ({
  getOAuthDpopClient: async () => mocks.dpopClient,
  getOAuthDpopJkt: async () => "sign-in-jkt",
}));

vi.mock("@zentity/sdk/rp", () => ({
  requestProofOfHumanToken: mocks.requestProofOfHumanToken,
}));

import { acquirePohToken, getProofOfHumanBinding } from "./poh-client";

describe("poh-client", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.accountRow = {
      accessToken: "x402-access-token",
      accountId: "x402-sub-1",
    };
  });

  it("binds a user with an x402 token to their subject and the sign-in jkt", async () => {
    await expect(getProofOfHumanBinding()).resolves.toEqual({
      jkt: "sign-in-jkt",
      subject: "x402-sub-1",
    });
  });

  it("reports no binding without an x402 token", async () => {
    mocks.accountRow = undefined;

    await expect(getProofOfHumanBinding()).resolves.toBeNull();
  });

  it("reports no binding without a session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(getProofOfHumanBinding()).resolves.toBeNull();
  });

  it("requests the PoH token with the sign-in DPoP client", async () => {
    mocks.requestProofOfHumanToken.mockResolvedValue({
      confirmationJkt: "sign-in-jkt",
      ok: true,
      token: "poh-token",
      unverifiedClaims: { tier: 2 },
    });

    await expect(acquirePohToken()).resolves.toEqual({
      claims: { tier: 2 },
      dpopJkt: "sign-in-jkt",
      token: "poh-token",
    });
    expect(mocks.requestProofOfHumanToken).toHaveBeenCalledWith({
      accessToken: "x402-access-token",
      dpopClient: mocks.dpopClient,
      proofOfHumanUrl: "http://zentity.example/api/auth/oauth2/proof-of-human",
    });
  });
});
