import { BaseError, UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";

import { getUserFriendlyError, isWalletRejection } from "../tx-errors";

describe("isWalletRejection", () => {
  it("detects a viem EIP-1193 rejection by class, even when wrapped", () => {
    const rejection = new UserRejectedRequestError(new Error("code 4001"));
    const wrapped = new BaseError("Something went wrong", { cause: rejection });

    expect(isWalletRejection(rejection)).toBe(true);
    expect(isWalletRejection(wrapped)).toBe(true);
  });

  it("falls back to the message for wallets that do not use code 4001", () => {
    expect(isWalletRejection(new Error("User rejected the request."))).toBe(
      true
    );
    expect(isWalletRejection(new Error("User denied message signature"))).toBe(
      true
    );
    expect(isWalletRejection("Request was cancelled")).toBe(true);
  });

  it("does not treat other failures as a rejection", () => {
    expect(isWalletRejection(new BaseError("RPC down"))).toBe(false);
    expect(isWalletRejection(new Error("insufficient funds"))).toBe(false);
  });
});

describe("getUserFriendlyError", () => {
  it("reports a wallet rejection as a cancelled transaction", () => {
    expect(
      getUserFriendlyError(new UserRejectedRequestError(new Error("code 4001")))
    ).toBe("Transaction was cancelled.");
  });
});
