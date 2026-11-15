import { describe, expect, it } from "vitest";

import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  hexToBytes,
  hkdfBits,
} from "@/lib/privacy/primitives/symmetric";

describe("hex codec", () => {
  it("round-trips with and without a 0x prefix", () => {
    const bytes = Uint8Array.from([0, 1, 0xab, 0xff]);
    expect(bytesToHex(bytes)).toBe("0001abff");
    expect(hexToBytes("0001abff")).toEqual(bytes);
    expect(hexToBytes("0x0001ABFF")).toEqual(bytes);
  });

  it("rejects empty and odd-length input", () => {
    expect(() => hexToBytes("")).toThrow("even-length");
    expect(() => hexToBytes("0x")).toThrow("even-length");
    expect(() => hexToBytes("abc")).toThrow("even-length");
  });

  it("rejects non-hex characters instead of coercing them to bytes", () => {
    expect(() => hexToBytes("zz")).toThrow();
    expect(() => hexToBytes("1z")).toThrow();
    expect(() => hexToBytes("0x12 4")).toThrow();
  });
});

describe("base64 codecs", () => {
  const bytes = Uint8Array.from([0xfb, 0xff, 0xfe, 0x01]);

  it("encodes standard base64 with padding", () => {
    expect(bytesToBase64(bytes)).toBe("+//+AQ==");
    expect(base64ToBytes("+//+AQ==")).toEqual(bytes);
  });

  it("encodes base64url without padding and decodes either form", () => {
    expect(bytesToBase64Url(bytes)).toBe("-__-AQ");
    expect(base64UrlToBytes("-__-AQ")).toEqual(bytes);
    expect(base64UrlToBytes("-__-AQ==")).toEqual(bytes);
    expect(base64UrlToBytes("+//+AQ==")).toEqual(bytes);
  });
});

describe("hkdfBits", () => {
  const ikm = new Uint8Array(32).fill(42);
  const info = "zentity-binding-passkey-v1";

  it("matches an independent HKDF-SHA256 vector with the default empty salt", async () => {
    const out = await hkdfBits(ikm, { info, bits: 256 });
    expect(bytesToHex(out)).toBe(
      "6084eef8614526e0690ae0f7a5f64f9de73fbbbdb18e6edfdac3d234802e64a6"
    );
  });

  it("returns the requested length", async () => {
    expect(await hkdfBits(ikm, { info, bits: 512 })).toHaveLength(64);
  });
});
