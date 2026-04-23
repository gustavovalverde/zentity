import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createdFirstPartyAuthOptions,
  mockCreateFirstPartyAuth,
  mockLoadCredentials,
  mockSaveCredentials,
} = vi.hoisted(() => ({
  createdFirstPartyAuthOptions: [] as Array<{
    issuerUrl: string;
    storage: {
      load(): unknown;
      save(state: { accessToken?: string; clientId?: string }): void;
    };
  }>,
  mockCreateFirstPartyAuth: vi.fn((options) => {
    createdFirstPartyAuthOptions.push(options);
    return { id: "first-party-auth" };
  }),
  mockLoadCredentials: vi.fn(),
  mockSaveCredentials: vi.fn(),
}));

vi.mock("@zentity/sdk/fpa", () => ({
  createFirstPartyAuth: mockCreateFirstPartyAuth,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000/",
  },
}));

vi.mock("../../src/auth/credentials.js", () => ({
  loadCredentials: mockLoadCredentials,
  saveCredentials: mockSaveCredentials,
}));

const { clearFirstPartyAuthCache, ensureFirstPartyAuth } = await import(
  "../../src/auth/first-party-auth.js"
);

describe("ensureFirstPartyAuth", () => {
  beforeEach(() => {
    clearFirstPartyAuthCache();
    createdFirstPartyAuthOptions.length = 0;
    mockCreateFirstPartyAuth.mockClear();
    mockLoadCredentials.mockReset();
    mockSaveCredentials.mockReset();
  });

  it("normalizes the issuer URL without changing the credential storage key", () => {
    ensureFirstPartyAuth("http://localhost:3000/");

    expect(createdFirstPartyAuthOptions[0]?.issuerUrl).toBe(
      "http://localhost:3000"
    );

    createdFirstPartyAuthOptions[0]?.storage.load();
    expect(mockLoadCredentials).toHaveBeenCalledWith("http://localhost:3000/");

    createdFirstPartyAuthOptions[0]?.storage.save({
      accessToken: "access-token",
      clientId: "client-1",
    });
    expect(mockSaveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        clientId: "client-1",
        zentityUrl: "http://localhost:3000/",
      })
    );
  });
});
