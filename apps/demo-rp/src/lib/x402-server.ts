import "server-only";

import type { PaymentRequirements } from "@x402/core/types";
import type { X402Resource } from "@/data/x402";
import { env } from "@/lib/env";
import { getMirrorAddress } from "@/lib/on-chain-compliance";

export interface X402RouteConfig {
  accepts: PaymentRequirements;
  description?: string;
  extensions?: Record<string, unknown>;
}

export function buildRouteConfig(resource: X402Resource): X402RouteConfig {
  const extensions: Record<string, unknown> = {};

  if (resource.requiredTier > 0) {
    const mirrorAddress = getMirrorAddress();
    extensions.zentity = {
      minComplianceLevel: resource.requiredTier,
      pohIssuer: env.NEXT_PUBLIC_ZENTITY_URL,
      ...(resource.requireOnChain && mirrorAddress
        ? { identityRegistryMirror: mirrorAddress }
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
