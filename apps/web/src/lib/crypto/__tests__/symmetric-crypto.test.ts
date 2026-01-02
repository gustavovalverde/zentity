import { describe, expect, it } from "vitest";

import {
  decryptAesGcm,
  encryptAesGcm,
  generateIv,
} from "@/lib/crypto/symmetric-crypto";

describe("symmetric-crypto", () => {
  it("round-trips AES-GCM encryption", async () => {
    const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
      "raw",
      keyMaterial,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );
    const plaintext = new TextEncoder().encode("hello-passkey");
    const aad = new TextEncoder().encode("aad");

    const encrypted = await encryptAesGcm(key, plaintext, aad);
    const decrypted = await decryptAesGcm(key, encrypted, aad);

    expect(new TextDecoder().decode(decrypted)).toBe("hello-passkey");
  });

  it("generates 12-byte IVs", () => {
    const iv = generateIv();
    expect(iv).toHaveLength(12);
  });
});
