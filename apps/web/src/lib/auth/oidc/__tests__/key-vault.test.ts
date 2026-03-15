import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptPrivateKey,
  encryptPrivateKey,
  resetKekCache,
} from "../key-vault";

const TEST_KEK = "a-test-key-encryption-key-that-is-at-least-32-chars";
const SAMPLE_PRIVATE_KEY = JSON.stringify({
  kty: "OKP",
  crv: "Ed25519",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
});

describe("key-vault", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetKekCache();
  });

  describe("with KEY_ENCRYPTION_KEY set", () => {
    it("encrypt/decrypt round-trip preserves plaintext", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      resetKekCache();

      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(encrypted).not.toBe(SAMPLE_PRIVATE_KEY);
      expect(encrypted).toContain('"v":');

      const decrypted = decryptPrivateKey(encrypted);
      expect(decrypted).toBe(SAMPLE_PRIVATE_KEY);
    });

    it("encrypted output is valid JSON envelope", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      resetKekCache();

      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      const envelope = JSON.parse(encrypted);
      expect(envelope.v).toBe(1);
      expect(typeof envelope.iv).toBe("string");
      expect(typeof envelope.ct).toBe("string");
    });

    it("different encryptions produce different ciphertexts (random IV)", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      resetKekCache();

      const a = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      const b = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(a).not.toBe(b);
    });

    it("wrong KEK fails decryption", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      resetKekCache();
      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);

      vi.stubEnv(
        "KEY_ENCRYPTION_KEY",
        "a-different-key-that-is-also-32-chars-long"
      );
      resetKekCache();

      expect(() => decryptPrivateKey(encrypted)).toThrow();
    });

    it("plaintext keys are returned as-is by decrypt (migration support)", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      resetKekCache();

      const result = decryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(result).toBe(SAMPLE_PRIVATE_KEY);
    });
  });

  describe("without KEY_ENCRYPTION_KEY", () => {
    it("encrypt returns plaintext unchanged", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", "");
      resetKekCache();

      const result = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(result).toBe(SAMPLE_PRIVATE_KEY);
    });

    it("decrypt returns plaintext unchanged", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", "");
      resetKekCache();

      const result = decryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(result).toBe(SAMPLE_PRIVATE_KEY);
    });

    it("decrypt throws if key is encrypted but no KEK is set", () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      resetKekCache();
      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);

      vi.stubEnv("KEY_ENCRYPTION_KEY", "");
      resetKekCache();

      expect(() => decryptPrivateKey(encrypted)).toThrow(
        "KEY_ENCRYPTION_KEY is required"
      );
    });
  });
});
