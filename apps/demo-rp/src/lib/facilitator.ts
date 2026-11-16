import "server-only";

import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { env } from "@/lib/env";

const facilitator = new HTTPFacilitatorClient(
  env.X402_FACILITATOR_URL ? { url: env.X402_FACILITATOR_URL } : undefined
);

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The library client throws on transport errors, timeouts, and non-2xx
 * answers. The route treats every one of them as a failed payment, so they
 * become `isValid: false` here.
 */
export async function verifyViaFacilitator(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<VerifyResponse> {
  try {
    return await facilitator.verify(paymentPayload, paymentRequirements);
  } catch (error) {
    return {
      isValid: false,
      invalidReason: failureMessage(error, "Verification failed"),
    };
  }
}

/** A settle timeout is indeterminate, so it is reported as a failure. */
export async function settleViaFacilitator(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<SettleResponse> {
  try {
    return await facilitator.settle(paymentPayload, paymentRequirements);
  } catch (error) {
    return {
      success: false,
      errorReason: failureMessage(error, "Settlement failed"),
      transaction: "",
      network: paymentRequirements.network,
    };
  }
}
