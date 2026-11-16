import { DEFAULT_ASSETS } from "@x402/evm";
import { REGISTERED_ASSETS } from "@zentity/sdk/protocol";
import { readOAuthAuthHints, readZentityExtension } from "@zentity/sdk/rp";
import { describe, expect, it, vi } from "vitest";
import type { X402Resource } from "@/data/x402";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/on-chain-compliance", () => ({
  getMirrorAddress: () => "0xa90723A47A14437500645Ece6049d0128A2f256D",
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_ZENTITY_URL: "https://app.zentity.xyz/",
  },
}));

import { buildRouteConfig } from "./x402-server";

function makeResource(overrides: Partial<X402Resource> = {}): X402Resource {
  return {
    id: "resource-1",
    name: "Regulated API",
    description: "Identity-gated resource",
    endpoint: "/api/x402/access",
    icon: {} as X402Resource["icon"],
    price: "$0.01",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredIdentityStrength: "cryptographic_chip",
    requireOnChain: true,
    responseData: { ok: true },
    ...overrides,
  };
}

function readBack(resource: X402Resource) {
  const { accepts, extensions } = buildRouteConfig(resource);
  const paymentRequired = {
    accepts: [{ ...accepts, network: accepts.network }],
    ...(extensions ? { extensions } : {}),
  };
  return {
    extensions,
    hints: readOAuthAuthHints(paymentRequired),
    zentity: readZentityExtension(paymentRequired),
  };
}

describe("buildRouteConfig", () => {
  // R7 and R15: the extensions are { info, schema } values agents read
  // back, and name the identity strength rather than a numeric level.
  it("advertises Zentity's issuer and the identity strength by name", () => {
    const { extensions, hints, zentity } = readBack(
      makeResource({ requireOnChain: false })
    );

    expect(hints).toEqual([
      {
        type: "oauth2",
        tokenType: "DPoP",
        authorizationServer: "https://app.zentity.xyz/api/auth",
        tokenEndpoint: "https://app.zentity.xyz/api/auth/oauth2/token",
        acceptIndexes: [0],
      },
    ]);
    expect(zentity).toEqual({ minIdentityStrength: "cryptographic_chip" });
    const serialized = JSON.stringify(extensions);
    expect(serialized).not.toContain("minComplianceLevel");
    expect(serialized).not.toContain("pohIssuer");
  });

  it("names the identity registry mirror for an on-chain resource", () => {
    expect(readBack(makeResource()).zentity).toEqual({
      minIdentityStrength: "cryptographic_chip",
      identityRegistryMirror: "0xa90723A47A14437500645Ece6049d0128A2f256D",
    });
  });

  it("advertises no extension for a payment-only resource", () => {
    expect(
      buildRouteConfig(makeResource({ requiredIdentityStrength: null }))
        .extensions
    ).toBeUndefined();
  });
});

// R32: the SDK's one registered asset is the one @x402/evm signs with.
describe("asset registry", () => {
  it("matches @x402/evm's Base Sepolia default asset", () => {
    const [registered] = REGISTERED_ASSETS;
    const [evmDefault] = DEFAULT_ASSETS["eip155:84532"] ?? [];

    expect(registered?.network).toBe("eip155:84532");
    expect(evmDefault).toBeDefined();
    expect({
      asset: registered?.asset,
      decimals: registered?.decimals,
      name: registered?.name,
      symbol: registered?.symbol,
      version: registered?.version,
    }).toEqual({
      asset: evmDefault?.asset,
      decimals: evmDefault?.decimals,
      name: evmDefault?.name,
      symbol: evmDefault?.symbol,
      version: evmDefault?.version,
    });
  });
});
