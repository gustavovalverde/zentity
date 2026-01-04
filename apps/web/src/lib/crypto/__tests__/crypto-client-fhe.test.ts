import { beforeEach, describe, expect, it, vi } from "vitest";

const tfheMocks = vi.hoisted(() => ({
  getOrCreateFheKeyRegistrationMaterial: vi.fn(),
  persistFheKeyId: vi.fn(),
  decryptFheBool: vi.fn(),
}));

vi.mock("@/lib/crypto/tfhe-browser", () => tfheMocks);

const trpcMocks = vi.hoisted(() => ({
  registerFheKey: { mutate: vi.fn() },
  verifyAgeFhe: { mutate: vi.fn() },
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    crypto: {
      registerFheKey: trpcMocks.registerFheKey,
      verifyAgeFhe: trpcMocks.verifyAgeFhe,
    },
  },
}));

import {
  ensureFheKeyRegistration,
  verifyAgeViaFHE,
} from "@/lib/crypto/crypto-client";

describe("crypto-client FHE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing key id without re-registering", async () => {
    tfheMocks.getOrCreateFheKeyRegistrationMaterial.mockResolvedValue({
      keyId: "existing-key",
      publicKeyB64: "public-key",
      serverKeyB64: "server-key",
    });

    const result = await ensureFheKeyRegistration();

    expect(result).toEqual({ keyId: "existing-key" });
    expect(trpcMocks.registerFheKey.mutate).not.toHaveBeenCalled();
    expect(tfheMocks.persistFheKeyId).not.toHaveBeenCalled();
  });

  it("registers server key and persists key id when missing", async () => {
    tfheMocks.getOrCreateFheKeyRegistrationMaterial.mockResolvedValue({
      publicKeyB64: "public-key",
      serverKeyB64: "server-key",
    });
    trpcMocks.registerFheKey.mutate.mockResolvedValue({ keyId: "new-key" });

    const result = await ensureFheKeyRegistration();

    expect(trpcMocks.registerFheKey.mutate).toHaveBeenCalledWith({
      serverKey: "server-key",
      publicKey: "public-key",
    });
    expect(tfheMocks.persistFheKeyId).toHaveBeenCalledWith("new-key");
    expect(result).toEqual({ keyId: "new-key" });
  });

  it("dedupes concurrent key registrations", async () => {
    tfheMocks.getOrCreateFheKeyRegistrationMaterial.mockResolvedValue({
      publicKeyB64: "public-key",
      serverKeyB64: "server-key",
    });
    let resolveRegister: ((value: { keyId: string }) => void) | undefined;
    const registerPromise = new Promise<{ keyId: string }>((resolve) => {
      resolveRegister = resolve;
    });
    trpcMocks.registerFheKey.mutate.mockReturnValue(registerPromise);

    const first = ensureFheKeyRegistration();
    const second = ensureFheKeyRegistration();

    resolveRegister?.({ keyId: "shared-key" });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual({ keyId: "shared-key" });
    expect(secondResult).toEqual({ keyId: "shared-key" });
    expect(trpcMocks.registerFheKey.mutate).toHaveBeenCalledTimes(1);
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
    trpcMocks.verifyAgeFhe.mutate.mockResolvedValue({
      resultCiphertext: "cipher",
    });
    tfheMocks.decryptFheBool.mockResolvedValue(true);

    const result = await verifyAgeViaFHE("ciphertext", "key-1", 2025, 18);

    expect(trpcMocks.verifyAgeFhe.mutate).toHaveBeenCalledWith({
      ciphertext: "ciphertext",
      currentYear: 2025,
      minAge: 18,
      keyId: "key-1",
    });
    expect(tfheMocks.decryptFheBool).toHaveBeenCalledWith("cipher");
    expect(result.isOver18).toBe(true);
  });
});
