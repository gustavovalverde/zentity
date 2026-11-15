import { describe, expect, it } from "vitest";

import { generateRecoveryKey, parseRecoveryKey } from "../recovery-key";

describe("recovery key", () => {
  it("generates 24 words encoding 32 bytes of entropy", () => {
    const { key, words } = generateRecoveryKey();

    expect(words).toHaveLength(24);
    expect(key.byteLength).toBe(32);
    expect(parseRecoveryKey(words.join(" "))).toEqual(key);
  });

  it("generates a different key every time", () => {
    expect(generateRecoveryKey().key).not.toEqual(generateRecoveryKey().key);
  });

  it("accepts words with any case, spacing, and numbering", () => {
    const { key, words } = generateRecoveryKey();
    const typed = words
      .map((word, index) => `${index + 1}. ${word.toUpperCase()}`)
      .join("\n   ");

    expect(parseRecoveryKey(typed)).toEqual(key);
  });

  it("rejects a phrase with the wrong word count", () => {
    const { words } = generateRecoveryKey();

    expect(parseRecoveryKey(words.slice(0, 23).join(" "))).toBeNull();
  });

  it("validates the BIP-39 checksum", () => {
    const zeros = Array.from({ length: 23 }, () => "abandon");

    expect(parseRecoveryKey([...zeros, "art"].join(" "))).toEqual(
      new Uint8Array(32)
    );
    expect(parseRecoveryKey([...zeros, "abandon"].join(" "))).toBeNull();
  });
});
