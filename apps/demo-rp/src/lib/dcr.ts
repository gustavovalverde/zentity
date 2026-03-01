import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { env } from "@/lib/env";

const PROVIDER_IDS = ["bank", "exchange", "wine", "aid", "veripass"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

const ENV_CLIENT_KEYS: Record<ProviderId, keyof typeof env> = {
  bank: "ZENTITY_BANK_CLIENT_ID",
  exchange: "ZENTITY_EXCHANGE_CLIENT_ID",
  wine: "ZENTITY_WINE_CLIENT_ID",
  aid: "ZENTITY_AID_CLIENT_ID",
  veripass: "ZENTITY_VERIPASS_CLIENT_ID",
};

export function isValidProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

export function dcrPath(providerId: ProviderId): string {
  return join(process.cwd(), ".data", `dcr-${providerId}.json`);
}

export function readDcrClientId(providerId: ProviderId): string | null {
  const path = dcrPath(providerId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return typeof data.client_id === "string" ? data.client_id : null;
  } catch {
    return null;
  }
}

export function resolveClientId(providerId: ProviderId): string {
  const dcrId = readDcrClientId(providerId);
  if (dcrId) {
    return dcrId;
  }

  const envKey = ENV_CLIENT_KEYS[providerId];
  const envId = env[envKey]?.trim();
  if (envId) {
    return envId;
  }

  return `pending-dcr-${providerId}`;
}

export function currentClientIdKey(): string {
  return PROVIDER_IDS.map((id) => `${id}:${readDcrClientId(id) ?? ""}`).join(
    "|"
  );
}

export { PROVIDER_IDS };
