import "server-only";

import type { PaymentRequirements } from "@x402/core/types";
import {
  buildAuthHintsExtension,
  buildZentityExtension,
} from "@zentity/sdk/rp";
import type { X402Resource } from "@/data/x402";
import { env } from "@/lib/env";
import { getMirrorAddress } from "@/lib/on-chain-compliance";

export interface X402RouteConfig {
  accepts: PaymentRequirements;
  description?: string;
  extensions?: Record<string, unknown>;
}

const TRAILING_SLASHES = /\/+$/;

/** Zentity's OAuth issuer, which agents must find in `auth-hints`. */
export function zentityAuthorizationServer(): string {
  return `${env.NEXT_PUBLIC_ZENTITY_URL.replace(TRAILING_SLASHES, "")}/api/auth`;
}

export function buildRouteConfig(resource: X402Resource): X402RouteConfig {
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

  if (!resource.requiredIdentityStrength) {
    return { accepts, description: resource.description };
  }

  const mirrorAddress = resource.requireOnChain ? getMirrorAddress() : null;
  const authorizationServer = zentityAuthorizationServer();
  return {
    accepts,
    description: resource.description,
    extensions: {
      "auth-hints": buildAuthHintsExtension({
        acceptIndexes: [0],
        authorizationServer,
        tokenEndpoint: `${authorizationServer}/oauth2/token`,
      }),
      zentity: buildZentityExtension({
        minIdentityStrength: resource.requiredIdentityStrength,
        ...(mirrorAddress ? { identityRegistryMirror: mirrorAddress } : {}),
      }),
    },
  };
}
