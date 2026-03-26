import "server-only";

// RouteConfig.accepts expects PaymentOption with `price`, but the x402 v2
// wire format uses `maxAmountRequired` + `asset` (enriched by the server at
// runtime). We build the enriched format directly.
interface EnrichedAccepts {
  asset: string;
  extra: Record<string, unknown>;
  maxAmountRequired: string;
  network: `${string}:${string}`;
  payTo: string;
  scheme: string;
}

export interface X402RouteConfig {
  accepts: EnrichedAccepts | EnrichedAccepts[];
  description?: string;
  extensions?: Record<string, unknown>;
}

import type { X402Resource } from "@/data/x402";
import { getRegistryAddress } from "@/lib/chain";
import { env } from "@/lib/env";

export function buildRouteConfig(resource: X402Resource): X402RouteConfig {
  const extensions: Record<string, unknown> = {};

  if (resource.requiredTier > 0) {
    extensions.zentity = {
      minComplianceLevel: resource.requiredTier,
      pohIssuer: `${env.ZENTITY_URL}/.well-known/poh-issuer`,
      ...(resource.requireOnChain && getRegistryAddress()
        ? { identityRegistry: getRegistryAddress() }
        : {}),
    };
  }

  const accepts = {
    scheme: "exact" as const,
    network: resource.network,
    payTo: resource.payTo,
    maxAmountRequired: resource.amountUnits,
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
