import "server-only";

const FACILITATOR_URL = "https://x402.org/facilitator";

interface VerifyResult {
  invalidReason?: string;
  isValid: boolean;
  payer?: string;
}

interface SettleResult {
  errorReason?: string;
  network?: string;
  success: boolean;
  transaction?: string;
}

export async function verifyPayment(
  paymentSignature: string,
  paymentRequirements: unknown
): Promise<VerifyResult> {
  try {
    const paymentPayload = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf8")
    );

    const res = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version ?? 2,
        paymentPayload,
        paymentRequirements,
      }),
    });

    if (!res.ok) {
      return {
        isValid: false,
        invalidReason: `Facilitator returned ${res.status}`,
      };
    }

    return (await res.json()) as VerifyResult;
  } catch (e) {
    return {
      isValid: false,
      invalidReason: e instanceof Error ? e.message : "Verification failed",
    };
  }
}

export async function settlePayment(
  paymentSignature: string,
  paymentRequirements: unknown
): Promise<SettleResult> {
  try {
    const paymentPayload = JSON.parse(
      Buffer.from(paymentSignature, "base64").toString("utf8")
    );

    const res = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version ?? 2,
        paymentPayload,
        paymentRequirements,
      }),
    });

    if (!res.ok) {
      return {
        success: false,
        errorReason: `Facilitator returned ${res.status}`,
      };
    }

    return (await res.json()) as SettleResult;
  } catch (e) {
    return {
      success: false,
      errorReason: e instanceof Error ? e.message : "Settlement failed",
    };
  }
}
