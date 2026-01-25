import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoist all mocks first
const secretsMocks = vi.hoisted(() => ({
  storeSecretWithCredential: vi.fn(),
  loadSecret: vi.fn(),
  PasskeyEnrollmentContext: {},
  EnrollmentCredential: {},
}));

const trpcMocks = vi.hoisted(() => ({
  secrets: {
    updateSecretMetadata: { mutate: vi.fn() },
  },
}));

// Apply mocks before any imports
vi.mock("@/lib/privacy/secrets", () => secretsMocks);
vi.mock("@/lib/trpc/client", () => ({ trpc: trpcMocks }));
vi.mock("@/lib/privacy/credentials/passkey", () => ({
  createSecretEnvelope: vi.fn(),
}));
vi.mock("@/lib/privacy/secrets/storage", () => ({
  uploadSecretBlob: vi.fn(),
}));
vi.mock("@/lib/privacy/secrets/types", () => ({
  SECRET_TYPES: { FHE_KEYS: "fhe_keys" },
}));

const makeBytes = (value: number, length: number) =>
  Uint8Array.from({ length }, () => value);

const makeEnrollment = () => ({
  credentialId: "cred-123",
  userId: "test-user-123",
  prfOutput: crypto.getRandomValues(new Uint8Array(32)),
  prfSalt: crypto.getRandomValues(new Uint8Array(32)),
});

describe("fhe-key-store", () => {
  let storeFheKeys: typeof import("../store").storeFheKeys;
  let getStoredFheKeys: typeof import("../store").getStoredFheKeys;
  let persistFheKeyId: typeof import("../store").persistFheKeyId;
  let resetFheKeyStoreCache: typeof import("../store").resetFheKeyStoreCache;

  beforeEach(async () => {
    vi.resetModules();
    // Re-import after reset to get fresh module with mocks applied
    const storeModule = await import("../store");
    storeFheKeys = storeModule.storeFheKeys;
    getStoredFheKeys = storeModule.getStoredFheKeys;
    persistFheKeyId = storeModule.persistFheKeyId;
    resetFheKeyStoreCache = storeModule.resetFheKeyStoreCache;

    resetFheKeyStoreCache();
    vi.clearAllMocks();
    secretsMocks.storeSecretWithCredential.mockResolvedValue({
      secretId: "secret-123",
      envelopeFormat: "msgpack",
    });
  });

  it("stores FHE keys and returns cached copy", async () => {
    const payload = {
      clientKey: makeBytes(1, 8),
      publicKey: makeBytes(2, 8),
      serverKey: makeBytes(3, 8),
      createdAt: new Date().toISOString(),
    };

    await storeFheKeys({ keys: payload, enrollment: makeEnrollment() });

    const stored = await getStoredFheKeys();

    expect(stored?.clientKey).toEqual(payload.clientKey);
    expect(stored?.publicKey).toEqual(payload.publicKey);
    expect(stored?.serverKey).toEqual(payload.serverKey);
    expect(secretsMocks.storeSecretWithCredential).toHaveBeenCalled();
    expect(secretsMocks.loadSecret).not.toHaveBeenCalled();
  });

  it("persists keyId metadata and updates cached keys", async () => {
    const payload = {
      clientKey: makeBytes(4, 4),
      publicKey: makeBytes(5, 4),
      serverKey: makeBytes(6, 4),
      createdAt: new Date().toISOString(),
    };

    await storeFheKeys({ keys: payload, enrollment: makeEnrollment() });
    await persistFheKeyId("key-123");

    expect(trpcMocks.secrets.updateSecretMetadata.mutate).toHaveBeenCalledWith({
      secretType: "fhe_keys",
      metadata: { keyId: "key-123" },
    });

    const stored = await getStoredFheKeys();
    expect(stored?.keyId).toBe("key-123");
  });
});
