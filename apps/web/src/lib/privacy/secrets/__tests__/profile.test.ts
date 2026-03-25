import { beforeEach, describe, expect, it, vi } from "vitest";

const secretsIndexMocks = vi.hoisted(() => ({
  storeSecretWithCredential: vi.fn(),
}));

const trpcMocks = vi.hoisted(() => ({
  secrets: {
    getSecretBundle: {
      query: vi.fn(),
    },
  },
}));

vi.mock("../index", () => secretsIndexMocks);
vi.mock("@/lib/trpc/client", () => ({ trpc: trpcMocks }));

describe("profile secret storage", () => {
  let assertProfileSecretStored: typeof import("../profile").assertProfileSecretStored;
  let resetProfileSecretCache: typeof import("../profile").resetProfileSecretCache;
  let storeProfileSecret: typeof import("../profile").storeProfileSecret;

  beforeEach(async () => {
    vi.resetModules();

    const profileModule = await import("../profile");
    assertProfileSecretStored = profileModule.assertProfileSecretStored;
    resetProfileSecretCache = profileModule.resetProfileSecretCache;
    storeProfileSecret = profileModule.storeProfileSecret;

    resetProfileSecretCache();
    vi.clearAllMocks();
    secretsIndexMocks.storeSecretWithCredential.mockResolvedValue({
      secretId: "secret-123",
      envelopeFormat: "json",
    });
  });

  it("does not attempt a new store when the profile secret already exists", async () => {
    trpcMocks.secrets.getSecretBundle.query.mockResolvedValue({
      secret: { id: "secret-123" },
      wrappers: [{ id: "wrapper-123" }],
    });

    await storeProfileSecret({
      extractedData: {
        extractedFirstName: "Ada",
        extractedFullName: "Ada Lovelace",
      },
      credential: {
        type: "opaque",
        context: {
          userId: "user-123",
          exportKey: crypto.getRandomValues(new Uint8Array(32)),
        },
      },
    });

    expect(secretsIndexMocks.storeSecretWithCredential).not.toHaveBeenCalled();
  });

  it("verifies the profile secret is visible after storing it", async () => {
    trpcMocks.secrets.getSecretBundle.query
      .mockResolvedValueOnce({ secret: null, wrappers: [] })
      .mockResolvedValueOnce({
        secret: { id: "secret-123" },
        wrappers: [{ id: "wrapper-123" }],
      });

    await storeProfileSecret({
      extractedData: {
        extractedDOB: "1815-12-10",
        extractedFirstName: "Ada",
        extractedFullName: "Ada Lovelace",
        extractedLastName: "Lovelace",
      },
      credential: {
        type: "opaque",
        context: {
          userId: "user-123",
          exportKey: crypto.getRandomValues(new Uint8Array(32)),
        },
      },
    });

    expect(secretsIndexMocks.storeSecretWithCredential).toHaveBeenCalledTimes(
      1
    );
    expect(trpcMocks.secrets.getSecretBundle.query).toHaveBeenCalledTimes(2);
  });

  it("throws when the profile secret still cannot be read after storing", async () => {
    trpcMocks.secrets.getSecretBundle.query
      .mockResolvedValueOnce({ secret: null, wrappers: [] })
      .mockResolvedValueOnce({ secret: null, wrappers: [] });

    await expect(
      storeProfileSecret({
        extractedData: {
          extractedFirstName: "Ada",
          extractedFullName: "Ada Lovelace",
        },
        credential: {
          type: "opaque",
          context: {
            userId: "user-123",
            exportKey: crypto.getRandomValues(new Uint8Array(32)),
          },
        },
      })
    ).rejects.toThrow(
      "Identity data could not be saved to your vault. Please retry verification."
    );
  });

  it("fails fast when the profile secret is missing", async () => {
    trpcMocks.secrets.getSecretBundle.query.mockResolvedValue({
      secret: null,
      wrappers: [],
    });

    await expect(assertProfileSecretStored()).rejects.toThrow(
      "Identity data could not be saved to your vault. Please retry verification."
    );
  });
});
