import { describe, expect, it } from "vitest";

import { computeUriConfirmationCode } from "./confirmation-code";

const BASE32_CODE_RE = /^[A-Z2-7]{6}$/;

describe("computeUriConfirmationCode", () => {
  it("returns a deterministic 6-character base32 code for the same payment URI", async () => {
    const first = await computeUriConfirmationCode(
      "zcash:utest1example?amount=0.0005"
    );
    const second = await computeUriConfirmationCode(
      "zcash:utest1example?amount=0.0005"
    );
    expect(first).toBe(second);
    expect(first).toHaveLength(6);
    expect(first).toMatch(BASE32_CODE_RE);
  });

  it("matches the canonical base32-of-SHA-256 prefix for a known input", async () => {
    expect(
      await computeUriConfirmationCode("zcash:utest1example?amount=0.0005")
    ).toBe("Z3I3QJ");
  });

  it("derives a distinct code for the empty string", async () => {
    const empty = await computeUriConfirmationCode("");
    expect(empty).toBe("4OYMIQ");
    expect(empty).not.toBe(
      await computeUriConfirmationCode("zcash:utest1example?amount=0.0005")
    );
  });

  it("flips when the URI changes by a single character", async () => {
    const first = await computeUriConfirmationCode(
      "zcash:utest1example?amount=1"
    );
    const second = await computeUriConfirmationCode(
      "zcash:utest1example?amount=2"
    );
    expect(first).not.toBe(second);
  });

  it("detects mismatches between a server-claimed code and a client re-derivation", async () => {
    const paymentUri = "zcash:utest1example?amount=0.0005";
    const serverClaimed = "AAAAAA";
    const clientDerived = await computeUriConfirmationCode(paymentUri);
    expect(clientDerived).not.toBe(serverClaimed);
    // Same input on both sides yields equality; this is the property the
    // bridge relies on to render the "Code mismatch" banner only when
    // the BFF and the client genuinely disagree.
    const honestServerCode = await computeUriConfirmationCode(paymentUri);
    expect(clientDerived).toBe(honestServerCode);
  });
});
