import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllCredentialCaches,
  clearCachedBindingMaterial,
  getCachedBindingMaterial,
  setCachedBindingMaterial,
} from "@/lib/privacy/credentials/cache";

describe("credential-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllCredentialCaches();
  });

  afterEach(() => {
    clearAllCredentialCaches();
    vi.useRealTimers();
  });

  it("wipes previous binding material when replaced", () => {
    const firstExportKey = new Uint8Array(64).fill(9);
    const secondSignature = new Uint8Array(65).fill(7);

    setCachedBindingMaterial({
      mode: "opaque",
      exportKey: firstExportKey,
    });
    setCachedBindingMaterial({
      mode: "wallet",
      signatureBytes: secondSignature,
    });

    expect(Array.from(firstExportKey).every((value) => value === 0)).toBe(true);
    expect(getCachedBindingMaterial()).toMatchObject({
      mode: "wallet",
    });
    expect(Array.from(secondSignature).every((value) => value === 7)).toBe(
      true
    );
  });

  it("wipes passkey binding bytes on explicit clear", () => {
    const prfOutput = new Uint8Array(32).fill(5);
    const prfSalt = new Uint8Array(32).fill(3);

    setCachedBindingMaterial({
      mode: "passkey",
      prfOutput,
      prfSalt,
      credentialId: "cred-1",
    });
    clearCachedBindingMaterial();

    expect(getCachedBindingMaterial()).toBeNull();
    expect(Array.from(prfOutput).every((value) => value === 0)).toBe(true);
    expect(Array.from(prfSalt).every((value) => value === 0)).toBe(true);
  });

  it("expires and wipes cached material via ttl fallback", () => {
    const signatureBytes = new Uint8Array(65).fill(4);
    setCachedBindingMaterial({
      mode: "wallet",
      signatureBytes,
    });

    vi.advanceTimersByTime(600_000);

    expect(getCachedBindingMaterial()).toBeNull();
    expect(Array.from(signatureBytes).every((value) => value === 0)).toBe(true);
  });
});
