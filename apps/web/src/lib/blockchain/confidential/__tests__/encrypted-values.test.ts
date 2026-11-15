import { describe, expect, it } from "vitest";

import { buildEncryptedHandle, buildInputProof } from "../encrypted-values";

describe("buildEncryptedHandle / buildInputProof", () => {
  it("passes through a 0x-prefixed hex string", () => {
    expect(buildEncryptedHandle("0xABcd", "country")).toBe("0xABcd");
    expect(buildInputProof("0xdead")).toBe("0xdead");
  });

  it("adds a missing 0x prefix", () => {
    expect(buildEncryptedHandle("abcd", "country")).toBe("0xabcd");
  });

  it("hex-encodes a Uint8Array with zero padding", () => {
    expect(buildEncryptedHandle(Uint8Array.of(1, 255), "country")).toBe(
      "0x01ff"
    );
    expect(buildEncryptedHandle(Uint8Array.of(10), "country")).toBe("0x0a");
  });

  it("throws a label-specific error when the value is missing", () => {
    expect(() => buildEncryptedHandle(undefined, "country")).toThrow(
      "missing country handle"
    );
    expect(() => buildEncryptedHandle("", "country")).toThrow(
      "missing country handle"
    );
    expect(() => buildInputProof(undefined)).toThrow("missing input proof");
  });

  it("rejects non-hex and empty-body strings", () => {
    expect(() => buildEncryptedHandle("0xnothex", "country")).toThrow(
      "missing country handle"
    );
    expect(() => buildEncryptedHandle("0x", "country")).toThrow(
      "missing country handle"
    );
  });

  it("rejects values that are neither a string nor a Uint8Array", () => {
    for (const value of [42, true, { handle: "0x01" }]) {
      expect(() =>
        buildEncryptedHandle(value as unknown as string, "country")
      ).toThrow("missing country handle");
      expect(() => buildInputProof(value as unknown as string)).toThrow(
        "missing input proof"
      );
    }
  });
});
