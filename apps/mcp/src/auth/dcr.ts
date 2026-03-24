import { config } from "../config.js";
import {
  buildInstalledAgentRegistrationRequest,
  getInstalledAgentRegistrationFingerprint,
} from "./auth-surfaces.js";
import {
  clearClientRegistration,
  loadCredentials,
  updateCredentials,
} from "./credentials.js";
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
  const registrationFingerprint = getInstalledAgentRegistrationFingerprint();

  if (
    existing?.clientId &&
    existing.registrationMethod === "dcr" &&
    existing.registrationFingerprint !== registrationFingerprint
  ) {
    console.error(
      "[dcr] Installed-agent registration contract changed, re-registering OAuth client..."
    );
    clearClientRegistration(config.zentityUrl);
  }

  const refreshed = loadCredentials(config.zentityUrl);
  if (
    refreshed?.clientId &&
    !options.force &&
    refreshed.registrationMethod === "dcr" &&
    refreshed.registrationFingerprint === registrationFingerprint
  ) {
    console.error(`[dcr] Reusing existing client_id: ${refreshed.clientId}`);
    return refreshed.clientId;
  }

  if (refreshed?.clientId && refreshed.registrationMethod === "cimd") {
    console.error(
      `[dcr] Ignoring cached CIMD client_id for stdio OAuth flow: ${refreshed.clientId}`
    );
  }

  if (!discovery.registration_endpoint) {
    throw new Error(
      "No registration_endpoint in discovery — cannot register via DCR"
    );
  }

  const body = buildInstalledAgentRegistrationRequest();

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
    registrationFingerprint,
    registrationMethod: "dcr",
  });

  console.error(`[dcr] Registered as client_id: ${data.client_id}`);
  return data.client_id;
}
