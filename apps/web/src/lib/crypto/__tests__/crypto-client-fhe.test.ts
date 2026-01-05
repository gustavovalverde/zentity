import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tfheMocks = vi.hoisted(() => ({
  getOrCreateFheKeyRegistrationMaterial: vi.fn(),
  persistFheKeyId: vi.fn(),
  decryptFheBool: vi.fn(),
}));

vi.mock("@/lib/crypto/tfhe-browser", () => tfheMocks);

const trpcMocks = vi.hoisted(() => ({
  crypto: {
    createChallenge: { mutate: vi.fn() },
  },
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: trpcMocks,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  ensureFheKeyRegistration,
  verifyAgeViaFHE,
} from "@/lib/crypto/crypto-client";

const makeMsgpackResponse = (payload: unknown) => {
  const encoded = encode(payload);
  const buffer = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  );
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    arrayBuffer: async () => buffer,
    text: async () => "",
  };
};

describe("crypto-client FHE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it("returns existing key id without re-registering", async () => {
    tfheMocks.getOrCreateFheKeyRegistrationMaterial.mockResolvedValue({
      keyId: "existing-key",
      publicKeyBytes: new Uint8Array([1, 2, 3]),
      serverKeyBytes: new Uint8Array([4, 5, 6]),
    });

    const result = await ensureFheKeyRegistration();

    expect(result).toEqual({ keyId: "existing-key" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tfheMocks.persistFheKeyId).not.toHaveBeenCalled();
  });

  it("registers server key and persists key id when missing", async () => {
    tfheMocks.getOrCreateFheKeyRegistrationMaterial.mockResolvedValue({
      publicKeyBytes: new Uint8Array([9]),
      serverKeyBytes: new Uint8Array([8]),
    });
    fetchMock.mockResolvedValue(makeMsgpackResponse({ keyId: "new-key" }));

    const result = await ensureFheKeyRegistration();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fhe/keys/register",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/msgpack",
          Accept: "application/msgpack",
        }),
      })
    );

    const payload = decode(
      fetchMock.mock.calls[0]?.[1]?.body as Uint8Array
    ) as {
      serverKey: Uint8Array;
      publicKey: Uint8Array;
    };
    expect(payload.serverKey).toEqual(new Uint8Array([8]));
    expect(payload.publicKey).toEqual(new Uint8Array([9]));

    expect(tfheMocks.persistFheKeyId).toHaveBeenCalledWith("new-key");
    expect(result).toEqual({ keyId: "new-key" });
  });

  it("dedupes concurrent key registrations", async () => {
    tfheMocks.getOrCreateFheKeyRegistrationMaterial.mockResolvedValue({
      publicKeyBytes: new Uint8Array([1]),
      serverKeyBytes: new Uint8Array([2]),
    });
    let resolveFetch: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const first = ensureFheKeyRegistration();
    const second = ensureFheKeyRegistration();

    resolveFetch?.(makeMsgpackResponse({ keyId: "shared-key" }));

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual({ keyId: "shared-key" });
    expect(secondResult).toEqual({ keyId: "shared-key" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tfheMocks.persistFheKeyId).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent proof challenge requests", async () => {
    const { getProofChallenge } = await import("@/lib/crypto/crypto-client");
    const challenge = {
      nonce: "nonce",
      circuitType: "age_verification",
      expiresAt: new Date().toISOString(),
    };
    const challengePromise = Promise.resolve(challenge);
    const createChallenge = vi.fn().mockReturnValue(challengePromise);

    const trpcClient = await import("@/lib/trpc/client");
    const originalCreateChallenge = trpcClient.trpc.crypto.createChallenge;
    trpcClient.trpc.crypto.createChallenge = { mutate: createChallenge };

    const first = getProofChallenge("age_verification");
    const second = getProofChallenge("age_verification");

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(challenge);
    expect(secondResult).toEqual(challenge);
    expect(createChallenge).toHaveBeenCalledTimes(1);

    trpcClient.trpc.crypto.createChallenge = originalCreateChallenge;
  });

  it("decrypts FHE verification result", async () => {
    const resultCiphertext = new Uint8Array([7, 7, 7]);
    fetchMock.mockResolvedValue(makeMsgpackResponse({ resultCiphertext }));
    tfheMocks.decryptFheBool.mockResolvedValue(true);

    const result = await verifyAgeViaFHE("key-1", 2025, 18);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fhe/verify-age",
      expect.objectContaining({
        method: "POST",
      })
    );
    const payload = decode(
      fetchMock.mock.calls[0]?.[1]?.body as Uint8Array
    ) as {
      keyId: string;
      currentYear: number;
      minAge: number;
    };
    expect(payload).toEqual({ keyId: "key-1", currentYear: 2025, minAge: 18 });
    expect(tfheMocks.decryptFheBool).toHaveBeenCalledWith(resultCiphertext);
    expect(result.isOver18).toBe(true);
  });
});
