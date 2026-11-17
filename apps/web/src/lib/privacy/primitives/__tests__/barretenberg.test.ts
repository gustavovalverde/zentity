import { BN254_FR_MODULUS } from "@aztec-foundation/bb.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bigIntToFr, poseidon2Hash } from "../barretenberg";

describe("bigIntToFr", () => {
  it("encodes as 32 big-endian bytes", () => {
    const fr = bigIntToFr(0x01_02n);
    expect(fr).toHaveLength(32);
    expect(Array.from(fr.slice(0, 30)).every((byte) => byte === 0)).toBe(true);
    expect(Array.from(fr.slice(30))).toEqual([1, 2]);
  });

  it("reduces modulo the BN254 scalar field", () => {
    expect(bigIntToFr(BN254_FR_MODULUS + 5n)).toEqual(bigIntToFr(5n));
    expect(bigIntToFr(BN254_FR_MODULUS)).toEqual(new Uint8Array(32));
  });
});

describe("poseidon2Hash", () => {
  it("matches the Poseidon2 vector for [1, 2]", async () => {
    await expect(poseidon2Hash([1n, 2n])).resolves.toBe(POSEIDON2_1_2);
  });
}, 60_000);

const POSEIDON2_1_2 =
  1594597865669602199208529098208508950092942746041644072252494753744672355203n;
