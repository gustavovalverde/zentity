import { config } from "../config.js";
import {
  buildInstalledAgentRegistrationRequest,
  getInstalledAgentRegistrationFingerprint,
} from "./auth-surfaces.js";
import { clearClientRegistration, loadCredentials } from "./credentials.js";
import type { DiscoveryState } from "./discovery.js";
import { ensureFirstPartyAuth } from "./first-party-auth.js";

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

  const clientId = await ensureFirstPartyAuth(
    config.zentityUrl
  ).ensureClientRegistration({
    ...(typeof options.force === "boolean" ? { force: options.force } : {}),
    request: buildInstalledAgentRegistrationRequest(),
  });

  console.error(`[dcr] Registered as client_id: ${clientId}`);
  return clientId;
}
