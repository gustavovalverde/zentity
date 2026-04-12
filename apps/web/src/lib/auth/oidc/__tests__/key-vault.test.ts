import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEK = "a-test-key-encryption-key-that-is-at-least-32-chars";
const SAMPLE_PRIVATE_KEY = JSON.stringify({
  kty: "OKP",
  crv: "Ed25519",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
});

describe("key-vault", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("with KEY_ENCRYPTION_KEY set", () => {
    it("encrypt/decrypt round-trip preserves plaintext", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      const { encryptPrivateKey, decryptPrivateKey } = await import(
        "../jwt/key-vault"
      );

      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(encrypted).not.toBe(SAMPLE_PRIVATE_KEY);
      expect(encrypted).toContain('"v":');

      const decrypted = decryptPrivateKey(encrypted);
      expect(decrypted).toBe(SAMPLE_PRIVATE_KEY);
    });

    it("encrypted output is valid JSON envelope", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      const { encryptPrivateKey } = await import("../jwt/key-vault");

      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      const envelope = JSON.parse(encrypted);
      expect(envelope.v).toBe(1);
      expect(typeof envelope.iv).toBe("string");
      expect(typeof envelope.ct).toBe("string");
    });

    it("different encryptions produce different ciphertexts (random IV)", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      const { encryptPrivateKey } = await import("../jwt/key-vault");

      const a = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      const b = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(a).not.toBe(b);
    });

    it("wrong KEK fails decryption", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      const { encryptPrivateKey } = await import("../jwt/key-vault");
      const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);

      vi.stubEnv(
        "KEY_ENCRYPTION_KEY",
        "a-different-key-that-is-also-32-chars-long"
      );
      vi.resetModules();
      const { decryptPrivateKey } = await import("../jwt/key-vault");

      expect(() => decryptPrivateKey(encrypted)).toThrow();
    });

    it("plaintext keys are returned as-is by decrypt (migration support)", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      const { decryptPrivateKey } = await import("../jwt/key-vault");

      const result = decryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(result).toBe(SAMPLE_PRIVATE_KEY);
    });
  });

  describe("without KEY_ENCRYPTION_KEY", () => {
    it("encrypt returns plaintext unchanged", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", "");
      const { encryptPrivateKey } = await import("../jwt/key-vault");

      const result = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(result).toBe(SAMPLE_PRIVATE_KEY);
    });

    it("decrypt returns plaintext unchanged", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", "");
      const { decryptPrivateKey } = await import("../jwt/key-vault");

      const result = decryptPrivateKey(SAMPLE_PRIVATE_KEY);
      expect(result).toBe(SAMPLE_PRIVATE_KEY);
    });

    it("decrypt throws if key is encrypted but no KEK is set", async () => {
      vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
      const mod1 = await import("../jwt/key-vault");
      const encrypted = mod1.encryptPrivateKey(SAMPLE_PRIVATE_KEY);

      vi.stubEnv("KEY_ENCRYPTION_KEY", "");
      vi.resetModules();
      const { decryptPrivateKey } = await import("../jwt/key-vault");

      expect(() => decryptPrivateKey(encrypted)).toThrow(
        "KEY_ENCRYPTION_KEY is required"
      );
    });
  });
});
