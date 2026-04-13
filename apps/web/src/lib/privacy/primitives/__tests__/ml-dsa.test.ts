import { describe, expect, it } from "vitest";

import {
  mlDsaKeygen,
  mlDsaSign,
  mlKemEncapsulate,
  mlKemKeygen,
} from "@/lib/privacy/primitives/post-quantum";

const ML_DSA_PUBLIC_KEY_BYTES = 1952;
const ML_DSA_SECRET_KEY_BYTES = 4032;
const ML_DSA_SIGNATURE_BYTES = 3309;
const ML_KEM_PUBLIC_KEY_BYTES = 1184;

describe("ml-dsa-65", () => {
  describe("keygen", () => {
    it("generates keypair with correct byte lengths", () => {
      const { publicKey, secretKey } = mlDsaKeygen();

      expect(publicKey).toHaveLength(ML_DSA_PUBLIC_KEY_BYTES);
      expect(secretKey).toHaveLength(ML_DSA_SECRET_KEY_BYTES);
    });

    it("is deterministic from 32-byte seed", () => {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const a = mlDsaKeygen(seed);
      const b = mlDsaKeygen(seed);

      expect(a.publicKey).toEqual(b.publicKey);
      expect(a.secretKey).toEqual(b.secretKey);
    });
  });

  describe("sign", () => {
    it("signature is correct length", () => {
      const { secretKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("test");

      const signature = mlDsaSign(message, secretKey);
      expect(signature).toHaveLength(ML_DSA_SIGNATURE_BYTES);
    });

    it("rejects undersized secret key", () => {
      const message = new TextEncoder().encode("test");
      expect(() => mlDsaSign(message, new Uint8Array(32))).toThrow(
        `must be ${ML_DSA_SECRET_KEY_BYTES} bytes`
      );
    });
  });

  describe("cross-algorithm confusion", () => {
    it("ML-DSA-65 public key rejected by mlKemEncapsulate (size mismatch)", () => {
      const dsaKey = mlDsaKeygen();

      expect(dsaKey.publicKey).toHaveLength(ML_DSA_PUBLIC_KEY_BYTES);
      expect(() => mlKemEncapsulate(dsaKey.publicKey)).toThrow(
        `must be ${ML_KEM_PUBLIC_KEY_BYTES} bytes`
      );
    });

    it("ML-KEM-768 public key size differs from ML-DSA-65", () => {
      const kemKey = mlKemKeygen();
      expect(kemKey.publicKey).toHaveLength(ML_KEM_PUBLIC_KEY_BYTES);
      expect(ML_KEM_PUBLIC_KEY_BYTES).not.toBe(ML_DSA_PUBLIC_KEY_BYTES);
    });
  });
});
