import { describe, expect, it } from "vitest";

import { computePublicKeyFingerprint } from "../keygen-client";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

describe("computePublicKeyFingerprint", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const key = crypto.getRandomValues(new Uint8Array(1024));
    const fp = await computePublicKeyFingerprint(key);

    expect(fp).toMatch(SHA256_HEX_RE);
  });

  it("is deterministic for the same input", async () => {
    const key = crypto.getRandomValues(new Uint8Array(256));
    const fp1 = await computePublicKeyFingerprint(key);
    const fp2 = await computePublicKeyFingerprint(key);

    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different keys", async () => {
    const keyA = crypto.getRandomValues(new Uint8Array(256));
    const keyB = crypto.getRandomValues(new Uint8Array(256));
    const fpA = await computePublicKeyFingerprint(keyA);
    const fpB = await computePublicKeyFingerprint(keyB);

    expect(fpA).not.toBe(fpB);
  });

  it("handles empty input", async () => {
    const fp = await computePublicKeyFingerprint(new Uint8Array(0));

    expect(fp).toMatch(SHA256_HEX_RE);
    // SHA-256 of empty input is well-known
    expect(fp).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
