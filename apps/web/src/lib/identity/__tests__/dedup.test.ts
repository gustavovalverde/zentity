import { describe, expect, it } from "vitest";

import {
  canonicalizeDocumentNumber,
  computeDedupKey,
  computeRpNullifier,
} from "../dedup";

const SECRET = "test-dedup-secret-at-least-32-chars-long";
const HEX_64 = /^[0-9a-f]{64}$/;

describe("canonicalizeDocumentNumber", () => {
  it("uppercases and strips non-alphanumeric characters", () => {
    expect(canonicalizeDocumentNumber("AB-123.456")).toBe("AB123456");
  });

  it("handles already-clean input", () => {
    expect(canonicalizeDocumentNumber("X12345")).toBe("X12345");
  });

  it("strips spaces, dashes, dots, slashes", () => {
    expect(canonicalizeDocumentNumber("a b/c-d.e")).toBe("ABCDE");
  });

  it("handles empty string", () => {
    expect(canonicalizeDocumentNumber("")).toBe("");
  });
});

describe("computeDedupKey", () => {
  it("produces deterministic output for the same inputs", () => {
    const key1 = computeDedupKey(SECRET, "AB-123", "US", "1990-01-15");
    const key2 = computeDedupKey(SECRET, "AB-123", "US", "1990-01-15");
    expect(key1).toBe(key2);
  });

  it("normalizes document number before hashing", () => {
    const key1 = computeDedupKey(SECRET, "AB-123", "US", "1990-01-15");
    const key2 = computeDedupKey(SECRET, "ab 123", "US", "1990-01-15");
    expect(key1).toBe(key2);
  });

  it("uppercases issuer country", () => {
    const key1 = computeDedupKey(SECRET, "X123", "us", "2000-06-01");
    const key2 = computeDedupKey(SECRET, "X123", "US", "2000-06-01");
    expect(key1).toBe(key2);
  });

  it("returns different keys for different document numbers", () => {
    const key1 = computeDedupKey(SECRET, "X123", "US", "1990-01-15");
    const key2 = computeDedupKey(SECRET, "Y456", "US", "1990-01-15");
    expect(key1).not.toBe(key2);
  });

  it("returns different keys for different countries", () => {
    const key1 = computeDedupKey(SECRET, "X123", "US", "1990-01-15");
    const key2 = computeDedupKey(SECRET, "X123", "GB", "1990-01-15");
    expect(key1).not.toBe(key2);
  });

  it("returns different keys for different DOBs", () => {
    const key1 = computeDedupKey(SECRET, "X123", "US", "1990-01-15");
    const key2 = computeDedupKey(SECRET, "X123", "US", "1990-01-16");
    expect(key1).not.toBe(key2);
  });

  it("returns a 64-character hex string", () => {
    const key = computeDedupKey(SECRET, "X123", "US", "1990-01-15");
    expect(key).toMatch(HEX_64);
  });

  it("produces different keys with different secrets", () => {
    const key1 = computeDedupKey(SECRET, "X123", "US", "1990-01-15");
    const key2 = computeDedupKey(
      "different-secret-also-at-least-32-chars",
      "X123",
      "US",
      "1990-01-15"
    );
    expect(key1).not.toBe(key2);
  });
});

describe("computeRpNullifier", () => {
  const dedupKey = computeDedupKey(SECRET, "X123", "US", "1990-01-15");

  it("same person + same RP = same nullifier", () => {
    const n1 = computeRpNullifier(SECRET, dedupKey, "client-bank");
    const n2 = computeRpNullifier(SECRET, dedupKey, "client-bank");
    expect(n1).toBe(n2);
  });

  it("same person + different RP = different nullifier", () => {
    const n1 = computeRpNullifier(SECRET, dedupKey, "client-bank");
    const n2 = computeRpNullifier(SECRET, dedupKey, "client-exchange");
    expect(n1).not.toBe(n2);
  });

  it("different person + same RP = different nullifier", () => {
    const otherKey = computeDedupKey(SECRET, "Y456", "GB", "2000-01-01");
    const n1 = computeRpNullifier(SECRET, dedupKey, "client-bank");
    const n2 = computeRpNullifier(SECRET, otherKey, "client-bank");
    expect(n1).not.toBe(n2);
  });

  it("returns a 64-character hex string", () => {
    const n = computeRpNullifier(SECRET, dedupKey, "client-bank");
    expect(n).toMatch(HEX_64);
  });
});
