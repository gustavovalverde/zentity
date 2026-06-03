import { describe, expect, it } from "vitest";

import {
  buildEncryptedHandle,
  buildInputProof,
  normalizeEncryptedHandle,
} from "../encrypted-values";

describe("normalizeEncryptedHandle", () => {
  it("passes through a 0x-prefixed hex string", () => {
    expect(normalizeEncryptedHandle("0xABcd")).toBe("0xABcd");
  });

  it("adds a missing 0x prefix", () => {
    expect(normalizeEncryptedHandle("abcd")).toBe("0xabcd");
  });

  it("hex-encodes a Uint8Array with zero padding", () => {
    expect(normalizeEncryptedHandle(Uint8Array.of(1, 255))).toBe("0x01ff");
  });

  it("rejects non-hex and empty-body strings", () => {
    expect(normalizeEncryptedHandle("0xnothex")).toBeUndefined();
    expect(normalizeEncryptedHandle("0x")).toBeUndefined();
  });

  it("returns undefined for nullish or non-hex-able input", () => {
    expect(normalizeEncryptedHandle(undefined)).toBeUndefined();
    expect(normalizeEncryptedHandle("")).toBeUndefined();
    expect(normalizeEncryptedHandle(null)).toBeUndefined();
    expect(normalizeEncryptedHandle(42)).toBeUndefined();
  });
});

describe("buildEncryptedHandle / buildInputProof", () => {
  it("returns the normalized value when present", () => {
    expect(buildEncryptedHandle(Uint8Array.of(10), "country")).toBe("0x0a");
    expect(buildInputProof("0xdead")).toBe("0xdead");
  });

  it("throws a label-specific error when the value is missing", () => {
    expect(() => buildEncryptedHandle(undefined, "country")).toThrow(
      "missing country handle"
    );
    expect(() => buildInputProof(undefined)).toThrow("missing input proof");
  });
});
