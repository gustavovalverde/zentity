import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeEd25519DidKey,
  decodeEd25519DidKeyToJwk,
  encodeEd25519DidKey,
  encodeEd25519DidKeyFromJwk,
  InvalidDidKeyFormatError,
  isEd25519DidKey,
} from "./did-key.js";

describe("did:key codec", () => {
  it("round-trips Ed25519 public keys deterministically", () => {
    for (let index = 0; index < 10_000; index += 1) {
      const publicKey = Uint8Array.from(randomBytes(32));
      const did = encodeEd25519DidKey(publicKey);

      expect(did.startsWith("did:key:z")).toBe(true);
      expect(decodeEd25519DidKey(did)).toEqual(publicKey);
      expect(encodeEd25519DidKey(decodeEd25519DidKey(did))).toBe(did);
      expect(isEd25519DidKey(did)).toBe(true);
    }
  });

  it("encodes and decodes Ed25519 public JWKs", () => {
    const publicJwk = {
      crv: "Ed25519" as const,
      kty: "OKP" as const,
      x: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
    };

    const did = encodeEd25519DidKeyFromJwk(publicJwk);

    expect(decodeEd25519DidKeyToJwk(did)).toEqual(publicJwk);
  });

  it("rejects malformed did:key values", () => {
    expect(() => decodeEd25519DidKey("")).toThrow(InvalidDidKeyFormatError);
    expect(() => decodeEd25519DidKey("did:example:abc")).toThrow(
      InvalidDidKeyFormatError
    );
    expect(() => decodeEd25519DidKey("did:key:f01234")).toThrow(
      InvalidDidKeyFormatError
    );
    expect(isEd25519DidKey("did:key:f01234")).toBe(false);
  });
});
