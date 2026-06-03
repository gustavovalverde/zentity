import { describe, expect, it } from "vitest";

import {
  HARDHAT_CONFIDENTIAL_CHAIN_ID,
  SEPOLIA_CONFIDENTIAL_CHAIN_ID,
} from "../client-networks";
import { getConfidentialGasOverride } from "../gas-overrides";

describe("getConfidentialGasOverride", () => {
  it("returns the measured budget for a known chain and operation", () => {
    expect(
      getConfidentialGasOverride(
        "attestWithPermit",
        HARDHAT_CONFIDENTIAL_CHAIN_ID
      )
    ).toEqual({ gas: 5_000_000n });
    expect(
      getConfidentialGasOverride(
        "grantAttributeAccess",
        SEPOLIA_CONFIDENTIAL_CHAIN_ID
      )
    ).toEqual({ gas: 1_000_000n });
  });

  it("returns undefined for an unsupported chain", () => {
    expect(getConfidentialGasOverride("attestWithPermit", 1)).toBeUndefined();
  });

  it("returns undefined when the chain id is unknown", () => {
    expect(
      getConfidentialGasOverride("grantAttributeAccess", undefined)
    ).toBeUndefined();
  });
});
