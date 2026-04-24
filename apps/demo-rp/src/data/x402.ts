export type { ProofOfHumanClaims as PohClaims } from "@zentity/sdk/rp";

import {
  CloudIcon,
  DashboardSquare01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export interface X402Resource {
  amount: string;
  asset: string;
  description: string;
  eip712Name: string;
  eip712Version: string;
  endpoint: string;
  icon: IconSvgElement;
  id: string;
  name: string;
  network: `${string}:${string}`;
  payTo: string;
  price: string;
  requiredTier: number;
  requireOnChain: boolean;
  responseData: Record<string, unknown>;
}

export const RESOURCES: X402Resource[] = [
  {
    id: "public-api",
    name: "Public API",
    description: "Weather data — payment only, no compliance",
    endpoint: "/api/weather/forecast",
    icon: CloudIcon,
    price: "$0.000001",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredTier: 0,
    requireOnChain: false,
    responseData: {
      forecast: [
        { day: "Mon", high: 22, low: 14, condition: "sunny" },
        { day: "Tue", high: 19, low: 12, condition: "cloudy" },
        { day: "Wed", high: 25, low: 16, condition: "sunny" },
      ],
      source: "weather-oracle.example",
    },
  },
  {
    id: "verified-identity",
    name: "Verified Identity",
    description: "Financial analytics — requires Tier 2+ (verified human)",
    endpoint: "/api/analytics/market",
    icon: DashboardSquare01Icon,
    price: "$0.000001",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredTier: 2,
    requireOnChain: false,
    responseData: {
      market: { index: "SPX", value: 5842.3, change: "+1.2%" },
      analysis:
        "Market sentiment bullish. Volume above 30d average. Volatility declining.",
      restricted: true,
    },
  },
  {
    id: "regulated-finance",
    name: "Regulated Financial API",
    description: "Cross-border settlement — Tier 3 + on-chain attestation",
    endpoint: "/api/defi/settle",
    icon: ShieldKeyIcon,
    price: "$0.000001",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    eip712Version: "2",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    requiredTier: 3,
    requireOnChain: true,
    responseData: {
      settlement: {
        id: "stl_7f3a9b2c",
        amount: "10,000 USDC",
        route: "ETH → Polygon bridge",
        status: "cleared",
      },
      compliance: { oracle: "zentity", level: "full", method: "fhevm" },
    },
  },
];

export function findResource(id: string): X402Resource | undefined {
  return RESOURCES.find((r) => r.id === id);
}

// --- Trace types ---

export type X402FlowState =
  | "idle"
  | "requesting"
  | "got402"
  | "obtainingPoh"
  | "gotPoh"
  | "retrying"
  | "success"
  | "denied";

export interface TraceEntry {
  body?: unknown;
  detail?: string;
  headers?: Record<string, string>;
  id: string;
  label?: string;
  link?: { href: string; text: string } | undefined;
  method?: string;
  status?: number;
  statusText?: string;
  timestamp: number;
  type: "request" | "response" | "action";
  url?: string;
}

const EXPLORER_URLS: Record<string, string> = {
  "eip155:84532": "https://sepolia.basescan.org/tx/",
  "eip155:8453": "https://basescan.org/tx/",
};

export function getExplorerUrl(network: string, txHash: string): string | null {
  const base = EXPLORER_URLS[network];
  return base ? `${base}${txHash}` : null;
}

export interface AccessOutcome {
  error?: string | undefined;
  granted: boolean;
  onChain?: { status: string } | undefined;
}

// --- Solidity reference snippets ---

export const SOLIDITY_FACILITATOR = `// x402 Facilitator — inline compliance check
contract Facilitator {
  IIdentityRegistry public immutable registry;
  uint8 public requiredLevel;

  function settleWithCompliance(
    address payer
  ) external returns (ebool) {
    // FHE comparison: is payer's level >= required?
    ebool compliant = registry.checkCompliance(
      payer, requiredLevel
    );

    // Conditional transfer: compliant ? amount : 0
    euint64 amount = FHE.asEuint64(10000);
    euint64 zero   = FHE.asEuint64(0);
    euint64 actual = FHE.select(
      compliant, amount, zero
    );

    return compliant;
  }
}`;

export const SOLIDITY_ISATTESTED = `// Simple view check (no FHE needed)
function isAttested(
  address user
) external view returns (bool);

// Returns true if the user has a valid
// on-chain attestation from a registrar.
// Used for HTTP-level gating; the FHE-based
// checkCompliance() is for on-chain settlement.`;
