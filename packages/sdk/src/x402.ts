import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentRequiredPayload,
} from "./rp/payment-required.js";

export interface X402ComplianceRequirement {
  identityRegistry?: string;
  minComplianceLevel: number;
  pohIssuer: string;
}

export interface X402PaymentContext {
  paymentRequired: PaymentRequiredPayload;
  request: Request;
  requirement: X402ComplianceRequirement;
}

export interface CreateX402FetchOptions {
  getPohToken(
    minComplianceLevel: number,
    context: X402PaymentContext
  ): Promise<string>;
  onRetryForbidden?(context: X402PaymentContext): void;
}

export interface X402FetchOptions extends RequestInit {
  x402?: {
    autoPayWithProofOfHuman?: boolean;
  };
}

export type X402Fetch = (
  input: RequestInfo | URL,
  init?: X402FetchOptions
) => Promise<Response>;

interface PaymentSignaturePayload {
  paymentRequired: PaymentRequiredPayload;
  pohToken: string;
  x402Version: 2;
}

function decodeBase64(encoded: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(encoded, "base64").toString("utf8");
  }

  if (typeof atob === "function") {
    return atob(encoded);
  }

  throw new Error("Base64 decoding is unavailable in this runtime");
}

function encodeBase64(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }

  if (typeof btoa === "function") {
    return btoa(text);
  }

  throw new Error("Base64 encoding is unavailable in this runtime");
}

function parsePaymentRequiredHeader(
  headerValue: string | null
): PaymentRequiredPayload | undefined {
  if (!headerValue) {
    return undefined;
  }

  const json = headerValue.trim().startsWith("{")
    ? headerValue
    : decodeBase64(headerValue);
  const parsed = JSON.parse(json) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const paymentRequired = parsed as Partial<PaymentRequiredPayload>;
  return paymentRequired.x402Version === 2
    ? (paymentRequired as PaymentRequiredPayload)
    : undefined;
}

function parseComplianceRequirement(
  paymentRequired: PaymentRequiredPayload
): X402ComplianceRequirement | undefined {
  const extension =
    paymentRequired.extensions?.zentity ??
    (paymentRequired as unknown as { zentity?: unknown }).zentity;
  if (!extension || typeof extension !== "object" || Array.isArray(extension)) {
    return undefined;
  }

  const fields = extension as Record<string, unknown>;
  const pohIssuer = resolvePohIssuerResource(fields.pohIssuer);
  if (typeof fields.minComplianceLevel !== "number" || !pohIssuer) {
    return undefined;
  }

  return {
    minComplianceLevel: fields.minComplianceLevel,
    pohIssuer,
    ...(typeof fields.identityRegistry === "string"
      ? { identityRegistry: fields.identityRegistry }
      : {}),
  };
}

function resolvePohIssuerResource(issuer: unknown): string | undefined {
  if (typeof issuer !== "string") {
    return undefined;
  }

  const trimmed = issuer.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}

function encodePaymentSignaturePayload(
  payload: PaymentSignaturePayload
): string {
  return encodeBase64(JSON.stringify(payload));
}

function requestHasJsonBody(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

function requestMethodAllowsBody(request: Request): boolean {
  return request.method !== "GET" && request.method !== "HEAD";
}

async function buildJsonRetryRequest(
  request: Request,
  headers: Headers,
  pohToken: string
): Promise<Request> {
  const bodyText = await request.clone().text();
  const parsed = bodyText ? JSON.parse(bodyText) : {};
  const body =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...parsed, pohToken }
      : { pohToken };

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  });
}

async function buildRetryRequest(
  request: Request,
  paymentRequired: PaymentRequiredPayload,
  pohToken: string
): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.set(
    PAYMENT_SIGNATURE_HEADER,
    encodePaymentSignaturePayload({
      x402Version: 2,
      paymentRequired,
      pohToken,
    })
  );

  if (requestMethodAllowsBody(request) && requestHasJsonBody(request)) {
    return buildJsonRetryRequest(request, headers, pohToken);
  }

  return new Request(request, { headers });
}

function shouldHandleX402(init: X402FetchOptions | undefined): boolean {
  return init?.x402?.autoPayWithProofOfHuman !== false;
}

function stripX402Options(
  init: X402FetchOptions | undefined
): RequestInit | undefined {
  if (!init || !("x402" in init)) {
    return init;
  }

  const { x402: _x402, ...requestInit } = init;
  return requestInit;
}

export function createX402Fetch(
  fetchFn: typeof globalThis.fetch,
  options: CreateX402FetchOptions
): X402Fetch {
  return async (input, init) => {
    const request = new Request(input, stripX402Options(init));
    const response = await fetchFn(request.clone());

    if (response.status !== 402 || !shouldHandleX402(init)) {
      return response;
    }

    const paymentRequired = parsePaymentRequiredHeader(
      response.headers.get(PAYMENT_REQUIRED_HEADER)
    );
    if (!paymentRequired) {
      return response;
    }

    const requirement = parseComplianceRequirement(paymentRequired);
    if (!requirement) {
      return response;
    }

    const context: X402PaymentContext = {
      paymentRequired,
      request,
      requirement,
    };
    const pohToken = await options.getPohToken(
      requirement.minComplianceLevel,
      context
    );
    const retryResponse = await fetchFn(
      await buildRetryRequest(request, paymentRequired, pohToken)
    );

    if (retryResponse.status === 403) {
      options.onRetryForbidden?.(context);
    }

    return retryResponse;
  };
}
