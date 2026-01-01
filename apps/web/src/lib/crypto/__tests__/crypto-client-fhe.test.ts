import { describe, expect, it, vi } from "vitest";

const tfheMocks = vi.hoisted(() => ({
  getOrCreateFheKeyMaterial: vi.fn(),
  getOrCreateFheKeyMaterialWithPasskey: vi.fn(),
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

import { ensureFheKeyRegistration, verifyAgeViaFHE } from "@/lib/crypto";

describe("crypto-client FHE", () => {
  it("returns existing key id without re-registering", async () => {
    tfheMocks.getOrCreateFheKeyMaterial.mockResolvedValue({
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
    tfheMocks.getOrCreateFheKeyMaterial.mockResolvedValue({
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
