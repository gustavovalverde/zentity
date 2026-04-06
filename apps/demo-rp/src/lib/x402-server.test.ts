import { describe, expect, it, vi } from "vitest";
import type { X402Resource } from "@/data/x402";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/chain", () => ({
  getRegistryAddress: () => "0xa90723A47A14437500645Ece6049d0128A2f256D",
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz",
  },
}));

import { buildRouteConfig } from "./x402-server";

function makeResource(overrides: Partial<X402Resource> = {}): X402Resource {
  return {
    id: "resource-1",
    name: "Regulated API",
    description: "Tier-gated resource",
    endpoint: "/api/x402/access",
    icon: {} as X402Resource["icon"],
    price: "$0.01",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredTier: 3,
    requireOnChain: true,
    responseData: { ok: true },
    ...overrides,
  };
}

describe("buildRouteConfig", () => {
  it("advertises the PoH issuer origin instead of the discovery URL", () => {
    const routeConfig = buildRouteConfig(makeResource());

    expect(routeConfig.extensions).toMatchObject({
      zentity: {
        pohIssuer: "https://app.zentity.xyz",
      },
    });
  });
});
