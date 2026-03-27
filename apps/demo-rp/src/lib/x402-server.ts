import "server-only";

import type { X402Resource } from "@/data/x402";
import { getRegistryAddress } from "@/lib/chain";
import { env } from "@/lib/env";

// The x402 v2 wire format for PaymentRequirements. Field names must match
// what @x402/evm's ExactEvmScheme reads: `amount`, `maxTimeoutSeconds`.
interface PaymentRequirements {
  amount: string;
  asset: string;
  extra: Record<string, unknown>;
  maxTimeoutSeconds: number;
  network: `${string}:${string}`;
  payTo: string;
  scheme: string;
}

export interface X402RouteConfig {
  accepts: PaymentRequirements | PaymentRequirements[];
  description?: string;
  extensions?: Record<string, unknown>;
}

export function buildRouteConfig(resource: X402Resource): X402RouteConfig {
  const extensions: Record<string, unknown> = {};

  if (resource.requiredTier > 0) {
    extensions.zentity = {
      minComplianceLevel: resource.requiredTier,
      pohIssuer: env.NEXT_PUBLIC_ZENTITY_URL,
      ...(resource.requireOnChain && getRegistryAddress()
        ? { identityRegistry: getRegistryAddress() }
        : {}),
    };
  }

  const accepts: PaymentRequirements = {
    scheme: "exact",
    network: resource.network,
    payTo: resource.payTo,
    amount: resource.amount,
    maxTimeoutSeconds: 300,
    asset: resource.asset,
    extra: {
      name: resource.eip712Name,
      version: resource.eip712Version,
    },
  };

  return {
    accepts,
    description: resource.description,
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}
