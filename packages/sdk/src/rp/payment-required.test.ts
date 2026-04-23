import { describe, expect, it } from "vitest";
import {
  buildPaymentRequiredPayload,
  createPaymentRequired,
  PAYMENT_REQUIRED_HEADER,
} from "./payment-required";

describe("createPaymentRequired", () => {
  it("builds an x402 v2 402 response with a PAYMENT-REQUIRED header", async () => {
    const response = createPaymentRequired({
      accepts: {
        scheme: "exact",
        network: "eip155:84532",
        payTo: "0x000000000000000000000000000000000000dEaD",
        amount: "1",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        extra: { name: "USDC", version: "2" },
      },
      resource: { url: "/api/x402/access" },
      description: "Tier-gated resource",
      extensions: {
        zentity: {
          minComplianceLevel: 3,
          pohIssuer: "https://app.zentity.xyz",
        },
      },
    });

    expect(response.status).toBe(402);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const payload = await response.json();
    expect(payload).toEqual(
      buildPaymentRequiredPayload({
        accepts: {
          scheme: "exact",
          network: "eip155:84532",
          payTo: "0x000000000000000000000000000000000000dEaD",
          amount: "1",
          maxTimeoutSeconds: 300,
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          extra: { name: "USDC", version: "2" },
        },
        resource: { url: "/api/x402/access" },
        description: "Tier-gated resource",
        extensions: {
          zentity: {
            minComplianceLevel: 3,
            pohIssuer: "https://app.zentity.xyz",
          },
        },
      })
    );

    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBe(
      Buffer.from(JSON.stringify(payload)).toString("base64")
    );
  });
});
