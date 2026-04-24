export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

export interface PaymentRequirement {
  amount: string;
  asset: string;
  extra?: Record<string, unknown>;
  maxTimeoutSeconds: number;
  network: `${string}:${string}`;
  payTo: string;
  scheme: string;
}

export interface PaymentRequiredPayload {
  accepts: PaymentRequirement | PaymentRequirement[];
  description?: string;
  extensions?: Record<string, unknown>;
  resource: {
    url: string;
  };
  x402Version: 2;
}

export interface CreatePaymentRequiredOptions {
  accepts: PaymentRequiredPayload["accepts"];
  description?: string;
  extensions?: Record<string, unknown>;
  resource: PaymentRequiredPayload["resource"];
}

function encodeBase64(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  throw new Error("Base64 encoding is unavailable in this runtime");
}

export function buildPaymentRequiredPayload(
  options: CreatePaymentRequiredOptions
): PaymentRequiredPayload {
  return {
    x402Version: 2,
    accepts: options.accepts,
    resource: options.resource,
    ...(options.description ? { description: options.description } : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
  };
}

export function createPaymentRequired(
  options: CreatePaymentRequiredOptions
): Response {
  const body = buildPaymentRequiredPayload(options);
  const encodedBody = encodeBase64(JSON.stringify(body));

  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      [PAYMENT_REQUIRED_HEADER]: encodedBody,
    },
  });
}

export function encodePaymentResponseHeader(settlement: unknown): string {
  return encodeBase64(JSON.stringify(settlement));
}
