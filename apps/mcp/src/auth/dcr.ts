import { config } from "../config.js";
import { loadCredentials, updateCredentials } from "./credentials.js";
import type { DiscoveryState } from "./discovery.js";

interface DcrResponse {
  client_id: string;
  client_secret?: string;
}

interface EnsureClientRegistrationOptions {
  force?: boolean;
}

export async function ensureClientRegistration(
  discovery: DiscoveryState,
  options: EnsureClientRegistrationOptions = {}
): Promise<string> {
  const existing = loadCredentials(config.zentityUrl);
  if (existing?.clientId && !options.force && existing.registrationMethod !== "cimd") {
    console.error(`[dcr] Reusing existing client_id: ${existing.clientId}`);
    return existing.clientId;
  }

  if (existing?.clientId && existing.registrationMethod === "cimd") {
    console.error(
      `[dcr] Ignoring cached CIMD client_id for stdio OAuth flow: ${existing.clientId}`
    );
  }

  if (!discovery.registration_endpoint) {
    throw new Error(
      "No registration_endpoint in discovery — cannot register via DCR"
    );
  }

  const redirectUri = "http://127.0.0.1/callback";

  const body = {
    client_name: "@zentity/mcp-server",
    redirect_uris: [redirectUri],
    scope:
      "openid email proof:identity identity.name identity.address agent:manage",
    token_endpoint_auth_method: "none",
    grant_types: [
      "authorization_code",
      "refresh_token",
      "urn:openid:params:grant-type:ciba",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ],
    response_types: ["code"],
    subject_type: "public",
  };

  const response = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DCR failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as DcrResponse;

  updateCredentials(config.zentityUrl, {
    clientId: data.client_id,
    ...(data.client_secret ? { clientSecret: data.client_secret } : {}),
    registrationMethod: "dcr",
  });

  console.error(`[dcr] Registered as client_id: ${data.client_id}`);
  return data.client_id;
}
