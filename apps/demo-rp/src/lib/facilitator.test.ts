import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settle: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: class {
    settle = mocks.settle;
    verify = mocks.verify;
  },
}));

import { settleViaFacilitator, verifyViaFacilitator } from "./facilitator";

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "1",
  payTo: "0x000000000000000000000000000000000000dEaD",
  maxTimeoutSeconds: 300,
  extra: {},
};
const payload: PaymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: {},
};

describe("facilitator adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the facilitator verify response through", async () => {
    mocks.verify.mockResolvedValue({ isValid: true, payer: "0xabc" });

    await expect(verifyViaFacilitator(payload, requirements)).resolves.toEqual({
      isValid: true,
      payer: "0xabc",
    });
    expect(mocks.verify).toHaveBeenCalledWith(payload, requirements);
  });

  it("reports a thrown verify error as an invalid payment", async () => {
    mocks.verify.mockRejectedValue(new Error("insufficient_funds"));

    await expect(verifyViaFacilitator(payload, requirements)).resolves.toEqual({
      isValid: false,
      invalidReason: "insufficient_funds",
    });
  });

  it("reports a thrown settle error as a failed settlement", async () => {
    mocks.settle.mockRejectedValue(new Error("timed out"));

    await expect(settleViaFacilitator(payload, requirements)).resolves.toEqual({
      success: false,
      errorReason: "timed out",
      transaction: "",
      network: "eip155:84532",
    });
  });
});
