import type { SchemeNetworkClient } from "@x402/core/types";

import { vi } from "vitest";

import {
  buildAuthHintsExtension,
  buildZentityExtension,
  createPaymentRequired,
  type PaymentRequiredPayload,
  type PaymentRequirement,
  PROOF_OF_HUMAN_CHALLENGE,
} from "../rp/payment-required";

/** Test fixtures for an x402 merchant that accepts Zentity Proof-of-Human. */

export const TEST_ISSUER = "https://issuer.example/api/auth";
export const MERCHANT_ORIGIN = "https://merchant.example";
export const RESOURCE_URL = `${MERCHANT_ORIGIN}/api/x402/access?resourceId=verified-identity`;
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PAY_TO = "0x000000000000000000000000000000000000dEaD";

export function requirement(
  overrides: Partial<PaymentRequirement> = {}
): PaymentRequirement {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1",
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

export interface TestPaymentRequiredOptions {
  accepts?: PaymentRequirement[];
  acceptIndexes?: number[];
  authorizationServer?: string;
  extensions?: Record<string, unknown>;
  identityRegistryMirror?: string;
  minIdentityStrength?: "documentary" | "documentary_full" | "cryptographic_chip";
  resourceUrl?: string;
}

function testExtensions(
  options: TestPaymentRequiredOptions,
  accepts: PaymentRequirement[]
): Record<string, unknown> {
  return (
    options.extensions ?? {
      "auth-hints": buildAuthHintsExtension({
        acceptIndexes: options.acceptIndexes ?? accepts.map((_, i) => i),
        authorizationServer: options.authorizationServer ?? TEST_ISSUER,
        tokenEndpoint: `${options.authorizationServer ?? TEST_ISSUER}/oauth2/token`,
      }),
      zentity: buildZentityExtension({
        minIdentityStrength: options.minIdentityStrength ?? "documentary_full",
        ...(options.identityRegistryMirror
          ? { identityRegistryMirror: options.identityRegistryMirror }
          : {}),
      }),
    }
  );
}

export function testPaymentRequired(
  options: TestPaymentRequiredOptions = {}
): PaymentRequiredPayload {
  const accepts = options.accepts ?? [requirement()];
  return {
    x402Version: 2,
    accepts,
    resource: {
      url: options.resourceUrl ?? RESOURCE_URL,
      description: "Financial analytics",
    },
    extensions: testExtensions(options, accepts),
  };
}

/** The merchant's 402 for a resource that needs a Zentity PoH token. */
export function paymentRequiredResponse(
  options: TestPaymentRequiredOptions = {}
): Response {
  const accepts = options.accepts ?? [requirement()];
  return createPaymentRequired({
    accepts,
    resource: { url: options.resourceUrl ?? RESOURCE_URL },
    description: "Financial analytics",
    extensions: testExtensions(options, accepts),
    wwwAuthenticate: PROOF_OF_HUMAN_CHALLENGE,
  });
}

/**
 * A scheme client that signs nothing. Like `ExactEvmScheme`, it recognizes
 * Base Sepolia USDC as a default asset, so `@x402/core` would apply its
 * default `$1` cap unless the caller sets one.
 */
export function createStubSchemeClient() {
  return {
    scheme: "exact",
    findDefaultAsset: (asset: string, network: string) =>
      network === "eip155:84532" && asset.toLowerCase() === USDC.toLowerCase()
        ? { asset: USDC, decimals: 6, symbol: "USDC" }
        : undefined,
    createPaymentPayload: vi.fn<SchemeNetworkClient["createPaymentPayload"]>(
      (x402Version) =>
        Promise.resolve({
          x402Version,
          payload: { signature: "0xstub", authorization: { from: "0xagent" } },
        })
    ),
  } satisfies SchemeNetworkClient;
}
