import { serializeSignature } from "viem";
import { describe, expect, it } from "vitest";

import { toContractSignature } from "../signature";

const R = `0x${"11".repeat(32)}` as const;
const S = `0x${"22".repeat(32)}` as const;

describe("toContractSignature", () => {
  it("keeps v of 27 and 28", () => {
    expect(toContractSignature(`${R}${S.slice(2)}1b`)).toEqual({
      r: R,
      s: S,
      v: 27,
    });
    expect(toContractSignature(`${R}${S.slice(2)}1c`)).toEqual({
      r: R,
      s: S,
      v: 28,
    });
  });

  it("normalizes a 0/1 parity byte to 27/28", () => {
    expect(toContractSignature(`${R}${S.slice(2)}00`).v).toBe(27);
    expect(toContractSignature(`${R}${S.slice(2)}01`).v).toBe(28);
  });

  it("round-trips through serializeSignature", () => {
    const { r, s, v } = toContractSignature(`${R}${S.slice(2)}00`);
    expect(serializeSignature({ r, s, v: BigInt(v) })).toBe(
      `${R}${S.slice(2)}1b`
    );
  });
});
