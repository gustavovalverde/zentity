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
    vi.stubEnv("KEY_ENCRYPTION_KEY", TEST_KEK);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypt/decrypt round-trip preserves plaintext", async () => {
    const { encryptPrivateKey, decryptPrivateKey } = await import(
      "../jwt-signer"
    );

    const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);
    expect(encrypted).not.toBe(SAMPLE_PRIVATE_KEY);
    expect(decryptPrivateKey(encrypted)).toBe(SAMPLE_PRIVATE_KEY);
  });

  it("encrypted output is valid JSON envelope", async () => {
    const { encryptPrivateKey } = await import("../jwt-signer");

    const envelope = JSON.parse(encryptPrivateKey(SAMPLE_PRIVATE_KEY));
    expect(envelope.v).toBe(1);
    expect(typeof envelope.iv).toBe("string");
    expect(typeof envelope.ct).toBe("string");
  });

  it("different encryptions produce different ciphertexts (random IV)", async () => {
    const { encryptPrivateKey } = await import("../jwt-signer");

    expect(encryptPrivateKey(SAMPLE_PRIVATE_KEY)).not.toBe(
      encryptPrivateKey(SAMPLE_PRIVATE_KEY)
    );
  });

  it("wrong KEK fails decryption", async () => {
    const { encryptPrivateKey } = await import("../jwt-signer");
    const encrypted = encryptPrivateKey(SAMPLE_PRIVATE_KEY);

    vi.stubEnv(
      "KEY_ENCRYPTION_KEY",
      "a-different-key-that-is-also-32-chars-long"
    );
    vi.resetModules();
    const { decryptPrivateKey } = await import("../jwt-signer");

    expect(() => decryptPrivateKey(encrypted)).toThrow();
  });

  it("refuses a stored private key that is not an encrypted envelope", async () => {
    const { decryptPrivateKey } = await import("../jwt-signer");

    expect(() => decryptPrivateKey(SAMPLE_PRIVATE_KEY)).toThrow(
      "not encrypted"
    );
  });

  it("refuses to start without a key encryption key", async () => {
    vi.stubEnv("KEY_ENCRYPTION_KEY", "");

    await expect(import("@/env")).rejects.toThrow();
  });
});
