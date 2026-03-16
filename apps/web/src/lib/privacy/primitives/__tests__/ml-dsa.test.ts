import { describe, expect, it } from "vitest";

import {
  ML_DSA_PUBLIC_KEY_BYTES,
  ML_DSA_SECRET_KEY_BYTES,
  ML_DSA_SIGNATURE_BYTES,
  mlDsaKeygen,
  mlDsaSign,
  mlDsaVerify,
} from "@/lib/privacy/primitives/ml-dsa";
import {
  ML_KEM_PUBLIC_KEY_BYTES,
  mlKemEncapsulate,
  mlKemKeygen,
} from "@/lib/privacy/primitives/ml-kem";

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

  describe("sign / verify", () => {
    it("round-trips: sign then verify returns true", () => {
      const { publicKey, secretKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("hello-post-quantum");

      const signature = mlDsaSign(message, secretKey);
      expect(mlDsaVerify(signature, message, publicKey)).toBe(true);
    });

    it("signature is correct length", () => {
      const { secretKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("test");

      const signature = mlDsaSign(message, secretKey);
      expect(signature).toHaveLength(ML_DSA_SIGNATURE_BYTES);
    });

    it("rejects modified message", () => {
      const { publicKey, secretKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("original");

      const signature = mlDsaSign(message, secretKey);
      const tampered = new TextEncoder().encode("tampered");

      expect(mlDsaVerify(signature, tampered, publicKey)).toBe(false);
    });

    it("rejects modified signature (bit flip)", () => {
      const { publicKey, secretKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("test");

      const signature = mlDsaSign(message, secretKey);
      const tampered = new Uint8Array(signature);
      const tamperedByte0 = tampered[0];
      if (tamperedByte0 !== undefined) {
        // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for signature integrity test
        tampered[0] = tamperedByte0 ^ 0xff;
      }

      expect(mlDsaVerify(tampered, message, publicKey)).toBe(false);
    });

    it("rejects wrong public key", () => {
      const alice = mlDsaKeygen();
      const eve = mlDsaKeygen();
      const message = new TextEncoder().encode("test");

      const signature = mlDsaSign(message, alice.secretKey);
      expect(mlDsaVerify(signature, message, eve.publicKey)).toBe(false);
    });
  });

  describe("degenerate inputs", () => {
    it("signs and verifies empty message", () => {
      const { publicKey, secretKey } = mlDsaKeygen();
      const empty = new Uint8Array(0);

      const signature = mlDsaSign(empty, secretKey);
      expect(mlDsaVerify(signature, empty, publicKey)).toBe(true);
    });

    it("zero-filled signature of correct length → verify returns false (no throw)", () => {
      const { publicKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("test");
      const zeroSig = new Uint8Array(ML_DSA_SIGNATURE_BYTES);

      expect(mlDsaVerify(zeroSig, message, publicKey)).toBe(false);
    });

    it("truncated signature → verify returns false", () => {
      const { publicKey } = mlDsaKeygen();
      const message = new TextEncoder().encode("test");
      const truncated = new Uint8Array(ML_DSA_SIGNATURE_BYTES - 1);

      expect(mlDsaVerify(truncated, message, publicKey)).toBe(false);
    });
  });

  describe("input validation", () => {
    it("rejects undersized secret key in sign", () => {
      const message = new TextEncoder().encode("test");
      expect(() => mlDsaSign(message, new Uint8Array(32))).toThrow(
        `must be ${ML_DSA_SECRET_KEY_BYTES} bytes`
      );
    });

    it("rejects undersized public key in verify", () => {
      const signature = new Uint8Array(ML_DSA_SIGNATURE_BYTES);
      const message = new TextEncoder().encode("test");
      expect(() => mlDsaVerify(signature, message, new Uint8Array(32))).toThrow(
        `must be ${ML_DSA_PUBLIC_KEY_BYTES} bytes`
      );
    });
  });

  describe("cross-algorithm confusion", () => {
    it("ML-KEM-768 public key rejected by mlDsaVerify (size mismatch)", () => {
      const kemKey = mlKemKeygen();
      const signature = new Uint8Array(ML_DSA_SIGNATURE_BYTES);
      const message = new TextEncoder().encode("test");

      expect(kemKey.publicKey).toHaveLength(ML_KEM_PUBLIC_KEY_BYTES);
      expect(() => mlDsaVerify(signature, message, kemKey.publicKey)).toThrow(
        `must be ${ML_DSA_PUBLIC_KEY_BYTES} bytes`
      );
    });

    it("ML-DSA-65 public key rejected by mlKemEncapsulate (size mismatch)", () => {
      const dsaKey = mlDsaKeygen();

      expect(dsaKey.publicKey).toHaveLength(ML_DSA_PUBLIC_KEY_BYTES);
      expect(() => mlKemEncapsulate(dsaKey.publicKey)).toThrow(
        `must be ${ML_KEM_PUBLIC_KEY_BYTES} bytes`
      );
    });
  });
});
