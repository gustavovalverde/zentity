import { describe, expect, it } from "vitest";

import { rewriteWorkerFetchInput } from "../worker-fetch";

describe("rewriteWorkerFetchInput", () => {
  const origin = "http://localhost:3000";

  it("rewrites local absolute paths against the app origin", () => {
    expect(rewriteWorkerFetchInput("/bb/barretenberg.wasm.gz", origin)).toBe(
      `${origin}/bb/barretenberg.wasm.gz`
    );
  });

  it("rewrites legacy CRS downloads through the local proxy", () => {
    expect(
      rewriteWorkerFetchInput("https://crs.aztec.network/g1.dat", origin)
    ).toBe(`${origin}/api/assets/bb-crs/g1.dat`);
  });

  it("rewrites current CRS CDN downloads through the local proxy", () => {
    expect(
      rewriteWorkerFetchInput(
        "https://crs.aztec-cdn.foundation/grumpkin_g1.dat",
        origin
      )
    ).toBe(`${origin}/api/assets/bb-crs/grumpkin_g1.dat`);
  });

  it("rewrites current CRS fallback downloads through the local proxy", () => {
    expect(
      rewriteWorkerFetchInput("https://crs.aztec-labs.com/g2.dat", origin)
    ).toBe(`${origin}/api/assets/bb-crs/g2.dat`);
  });

  it("preserves unrelated URLs", () => {
    expect(
      rewriteWorkerFetchInput("https://cdn.zkpassport.id/sdk.js", origin)
    ).toBe("https://cdn.zkpassport.id/sdk.js");
  });
});
