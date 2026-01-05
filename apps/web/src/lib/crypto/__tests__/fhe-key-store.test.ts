import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getStoredFheKeys,
  persistFheKeyId,
  resetFheKeyStoreCache,
  storeFheKeys,
} from "@/lib/crypto/fhe-key-store";

const trpcMocks = vi.hoisted(() => ({
  secrets: {
    storeSecret: { mutate: vi.fn() },
    getSecretBundle: { query: vi.fn() },
    updateSecretMetadata: { mutate: vi.fn() },
    addWrapper: { mutate: vi.fn() },
  },
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: trpcMocks,
}));

vi.mock("@/lib/crypto/webauthn-prf", () => ({
  evaluatePrf: vi.fn(),
}));

const makeBytes = (value: number, length: number) =>
  Uint8Array.from({ length }, () => value);

const makeEnrollment = () => ({
  credentialId: "cred-123",
  prfOutput: crypto.getRandomValues(new Uint8Array(32)),
  prfSalt: crypto.getRandomValues(new Uint8Array(32)),
});

const fetchMock = vi.fn();

beforeEach(() => {
  resetFheKeyStoreCache();
  vi.clearAllMocks();
  fetchMock.mockReset();
  // @ts-expect-error - test global override
  globalThis.fetch = fetchMock;
});

describe("fhe-key-store", () => {
  it("stores FHE keys and returns cached copy", async () => {
    const payload = {
      clientKey: makeBytes(1, 8),
      publicKey: makeBytes(2, 8),
      serverKey: makeBytes(3, 8),
      createdAt: new Date().toISOString(),
    };

    trpcMocks.secrets.storeSecret.mutate.mockResolvedValue({
      secret: { id: "secret" },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      }),
    });

    await storeFheKeys({ keys: payload, enrollment: makeEnrollment() });

    const stored = await getStoredFheKeys();

    expect(stored?.clientKey).toEqual(payload.clientKey);
    expect(stored?.publicKey).toEqual(payload.publicKey);
    expect(stored?.serverKey).toEqual(payload.serverKey);
    expect(trpcMocks.secrets.storeSecret.mutate).toHaveBeenCalled();
    expect(trpcMocks.secrets.getSecretBundle.query).not.toHaveBeenCalled();
  });

  it("persists keyId metadata and updates cached keys", async () => {
    const payload = {
      clientKey: makeBytes(4, 4),
      publicKey: makeBytes(5, 4),
      serverKey: makeBytes(6, 4),
      createdAt: new Date().toISOString(),
    };

    trpcMocks.secrets.storeSecret.mutate.mockResolvedValue({
      secret: { id: "secret" },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      }),
    });

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
