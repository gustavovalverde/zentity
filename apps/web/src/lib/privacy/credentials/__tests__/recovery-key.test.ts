import { describe, expect, it } from "vitest";

import { generateDek } from "@/lib/privacy/secrets/envelope";

import { wrapDekWithOpaqueExport } from "../opaque";
import {
  generateRecoveryKey,
  parseRecoveryKey,
  unwrapDekWithRecoveryKey,
  wrapDekWithRecoveryKey,
} from "../recovery-key";

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

  it("wraps and unwraps a DEK", async () => {
    const secretId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const dek = generateDek();
    const { key } = generateRecoveryKey();

    const wrappedDek = await wrapDekWithRecoveryKey({
      secretId,
      userId,
      dek,
      recoveryKey: key,
    });

    await expect(
      unwrapDekWithRecoveryKey({
        secretId,
        userId,
        wrappedDek,
        recoveryKey: key,
      })
    ).resolves.toEqual(dek);
  });

  it("fails to unwrap with a different key or user", async () => {
    const secretId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const dek = generateDek();
    const { key } = generateRecoveryKey();
    const wrappedDek = await wrapDekWithRecoveryKey({
      secretId,
      userId,
      dek,
      recoveryKey: key,
    });

    await expect(
      unwrapDekWithRecoveryKey({
        secretId,
        userId,
        wrappedDek,
        recoveryKey: generateRecoveryKey().key,
      })
    ).rejects.toThrow();
    await expect(
      unwrapDekWithRecoveryKey({
        secretId,
        userId: crypto.randomUUID(),
        wrappedDek,
        recoveryKey: key,
      })
    ).rejects.toThrow();
  });

  it("is domain-separated from other credential KEKs", async () => {
    const secretId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const dek = generateDek();
    const { key } = generateRecoveryKey();
    const opaqueWrapped = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey: new Uint8Array([...key, ...key]),
    });

    await expect(
      unwrapDekWithRecoveryKey({
        secretId,
        userId,
        wrappedDek: opaqueWrapped,
        recoveryKey: key,
      })
    ).rejects.toThrow();
  });
});
