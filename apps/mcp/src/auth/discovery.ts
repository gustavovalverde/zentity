import { z } from "zod";

const discoverySchema = z.object({
  issuer: z.string(),
  token_endpoint: z.string(),
  authorization_endpoint: z.string(),
  registration_endpoint: z.string().optional(),
  authorization_challenge_endpoint: z.string().optional(),
  backchannel_authentication_endpoint: z.string().optional(),
  pushed_authorization_request_endpoint: z.string().optional(),
  jwks_uri: z.string().optional(),
  dpop_signing_alg_values_supported: z.array(z.string()).optional(),
  require_pushed_authorization_requests: z.boolean().optional(),
  client_id_metadata_document_supported: z.boolean().optional(),
});

export type DiscoveryState = z.infer<typeof discoverySchema>;

let cachedDiscovery: DiscoveryState | undefined;

export async function discover(zentityUrl: string): Promise<DiscoveryState> {
  if (cachedDiscovery) {
    return cachedDiscovery;
  }

  const url = `${zentityUrl}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Discovery failed: ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  const state = discoverySchema.parse(json);
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
}
