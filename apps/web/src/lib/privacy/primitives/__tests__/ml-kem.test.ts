import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";

import {
  isValidMlKemPublicKey,
  ML_KEM_SECRET_KEY_BYTES,
  mlKemEncapsulate,
  mlKemGetPublicKey,
  mlKemKeygen,
} from "@/lib/privacy/primitives/post-quantum";

const ML_KEM_PUBLIC_KEY_BYTES = 1184;
const ML_KEM_CIPHERTEXT_BYTES = 1088;
const ML_KEM_SHARED_SECRET_BYTES = 32;

describe("ml-kem-768", () => {
  describe("keygen", () => {
    it("generates keypair with correct byte lengths", () => {
      const { publicKey, secretKey } = mlKemKeygen();

      expect(publicKey).toHaveLength(ML_KEM_PUBLIC_KEY_BYTES);
      expect(secretKey).toHaveLength(ML_KEM_SECRET_KEY_BYTES);
    });

    it("generates unique keypairs on each call", () => {
      const a = mlKemKeygen();
      const b = mlKemKeygen();

      expect(a.publicKey).not.toEqual(b.publicKey);
      expect(a.secretKey).not.toEqual(b.secretKey);
    });

    it("is deterministic from fixed 64-byte seed", () => {
      const seed = crypto.getRandomValues(new Uint8Array(64));
      const a = mlKemKeygen(seed);
      const b = mlKemKeygen(seed);

      expect(a.publicKey).toEqual(b.publicKey);
      expect(a.secretKey).toEqual(b.secretKey);
    });
  });

  describe("encapsulate", () => {
    it("round-trips: both sides derive same 32-byte shared secret", () => {
      const { publicKey, secretKey } = mlKemKeygen();
      const { cipherText, sharedSecret: senderSecret } =
        mlKemEncapsulate(publicKey);
      const receiverSecret = ml_kem768.decapsulate(cipherText, secretKey);

      expect(senderSecret).toHaveLength(ML_KEM_SHARED_SECRET_BYTES);
      expect(receiverSecret).toHaveLength(ML_KEM_SHARED_SECRET_BYTES);
      expect(senderSecret).toEqual(receiverSecret);
    });

    it("produces ciphertext of correct length", () => {
      const { publicKey } = mlKemKeygen();
      const { cipherText } = mlKemEncapsulate(publicKey);

      expect(cipherText).toHaveLength(ML_KEM_CIPHERTEXT_BYTES);
    });

    it("encapsulate is non-deterministic (fresh randomness)", () => {
      const { publicKey } = mlKemKeygen();
      const a = mlKemEncapsulate(publicKey);
      const b = mlKemEncapsulate(publicKey);

      expect(a.cipherText).not.toEqual(b.cipherText);
      expect(a.sharedSecret).not.toEqual(b.sharedSecret);
    });
  });

  describe("input validation", () => {
    it("rejects undersized public key in encapsulate", () => {
      expect(() => mlKemEncapsulate(new Uint8Array(32))).toThrow(
        `must be ${ML_KEM_PUBLIC_KEY_BYTES} bytes`
      );
    });

    it("rejects oversized public key in encapsulate", () => {
      expect(() => mlKemEncapsulate(new Uint8Array(2000))).toThrow(
        `must be ${ML_KEM_PUBLIC_KEY_BYTES} bytes`
      );
    });
  });

  describe("isValidMlKemPublicKey", () => {
    it("accepts valid 1184-byte key as base64", () => {
      const { publicKey } = mlKemKeygen();
      const base64 = Buffer.from(publicKey).toString("base64");
      expect(isValidMlKemPublicKey(base64)).toBe(true);
    });

    it("rejects 32-byte X25519 key (old format)", () => {
      const oldKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
      expect(isValidMlKemPublicKey(oldKey.toString("base64"))).toBe(false);
    });

    it("rejects non-base64 string", () => {
      expect(isValidMlKemPublicKey("not-valid-base64!!!")).toBe(false);
    });
  });

  describe("getPublicKey", () => {
    it("derives public key matching keygen output", () => {
      const { publicKey, secretKey } = mlKemKeygen();
      const derived = mlKemGetPublicKey(secretKey);

      expect(derived).toEqual(publicKey);
    });
  });
});
