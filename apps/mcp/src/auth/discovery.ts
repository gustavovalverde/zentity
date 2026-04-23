import type { FirstPartyAuthDiscoveryDocument } from "@zentity/sdk/fpa";
import {
  clearFirstPartyAuthCache,
  ensureFirstPartyAuth,
} from "./first-party-auth.js";

export type DiscoveryState = FirstPartyAuthDiscoveryDocument;

let cachedDiscovery: DiscoveryState | undefined;

export async function discover(zentityUrl: string): Promise<DiscoveryState> {
  if (cachedDiscovery) {
    return cachedDiscovery;
  }

  const state = await ensureFirstPartyAuth(zentityUrl).discover();
  cachedDiscovery = state;

  console.error("[discovery] Discovered endpoints:");
  console.error(`  issuer: ${state.issuer}`);
  console.error(`  token: ${state.token_endpoint}`);
  if (state.registration_endpoint) {
    console.error(`  register: ${state.registration_endpoint}`);
  }
  if (state.authorization_challenge_endpoint) {
    console.error(`  challenge: ${state.authorization_challenge_endpoint}`);
  }
  if (state.backchannel_authentication_endpoint) {
    console.error(`  ciba: ${state.backchannel_authentication_endpoint}`);
  }

  return state;
}

export function getDiscoveredIssuer(): string | undefined {
  return cachedDiscovery?.issuer;
}

export function getDiscoveredJwksUri(): string | undefined {
  return cachedDiscovery?.jwks_uri;
}

export function clearDiscoveryCache(): void {
  cachedDiscovery = undefined;
  clearFirstPartyAuthCache();
}
