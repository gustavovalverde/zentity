import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDpopClientFromKeyPair: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@zentity/sdk/rp", () => ({
  createDpopClientFromKeyPair: mocks.createDpopClientFromKeyPair,
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: () => ({ query: { oauthDpopKey: { findFirst: mocks.findFirst } } }),
}));

const keyRow = {
  privateJwk: JSON.stringify({ crv: "P-256", d: "d", kty: "EC" }),
  publicJwk: JSON.stringify({ crv: "P-256", kty: "EC", x: "x", y: "y" }),
};

describe("getOAuthDpopClient", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createDpopClientFromKeyPair.mockImplementation(async (keyPair) => ({
      keyPair,
    }));
  });

  it("reuses the client remembered at token exchange", async () => {
    const { getOAuthDpopClient, rememberOAuthDpopClient } = await import(
      "./oauth-dpop-client"
    );
    const client = { keyPair: {} } as never;

    rememberOAuthDpopClient("at-1", client);

    await expect(getOAuthDpopClient("at-1")).resolves.toBe(client);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("builds a client from the stored key once and reuses it", async () => {
    const { getOAuthDpopClient } = await import("./oauth-dpop-client");
    mocks.findFirst.mockResolvedValue(keyRow);

    const first = await getOAuthDpopClient("at-2");
    const second = await getOAuthDpopClient("at-2");

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.createDpopClientFromKeyPair).toHaveBeenCalledTimes(1);
    expect(mocks.createDpopClientFromKeyPair).toHaveBeenCalledWith({
      privateJwk: JSON.parse(keyRow.privateJwk),
      publicJwk: JSON.parse(keyRow.publicJwk),
    });
  });

  it("returns null when no key was stored for the token", async () => {
    const { getOAuthDpopClient } = await import("./oauth-dpop-client");
    mocks.findFirst.mockResolvedValue(undefined);

    await expect(getOAuthDpopClient("unknown")).resolves.toBeNull();
    expect(mocks.createDpopClientFromKeyPair).not.toHaveBeenCalled();
  });
});
