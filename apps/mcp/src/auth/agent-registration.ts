import {
  buildHostKeyNamespace as buildSdkHostKeyNamespace,
  registerHost,
  registerAgentSession as registerSdkAgentSession,
  AgentRegistrationError as SdkAgentRegistrationError,
  signAgentAssertion as signSdkAgentAssertion,
} from "@zentity/sdk";
import { createDpopClientFromKeyPair } from "@zentity/sdk/rp";
import type { AgentInfo } from "../agent.js";
import { config } from "../config.js";
import { discoverAgentConfiguration } from "./agent-configuration.js";
import { RUNTIME_BOOTSTRAP_SCOPE_STRING } from "./bootstrap-scopes.js";
import type { OAuthSessionContext } from "./context.js";
import {
  clearHostId,
  getOrCreateHostKey,
  loadHostKey,
  saveHostKey,
} from "./host-key.js";
import type { AgentRuntimeState } from "./runtime-state.js";
import { exchangeToken } from "./token-exchange.js";

const REQUESTED_CAPABILITIES = [
  "purchase",
  "my_profile",
  "whoami",
  "my_proofs",
  "check_compliance",
];

export const AgentRegistrationError = SdkAgentRegistrationError;
export const buildHostKeyNamespace = buildSdkHostKeyNamespace;

export async function prepareBootstrapRegistrationAuth(
  auth: OAuthSessionContext
): Promise<OAuthSessionContext> {
  const agentConfiguration = await discoverAgentConfiguration(
    config.zentityUrl
  );
  const tokenEndpoint = new URL(
    "/api/auth/oauth2/token",
    config.zentityUrl
  ).toString();
  const { accessToken } = await exchangeToken({
    tokenEndpoint,
    subjectToken: auth.accessToken,
    audience: agentConfiguration.bootstrap_token_exchange.audience,
    clientId: auth.clientId,
    dpopKey: auth.dpopKey,
    scope:
      agentConfiguration.bootstrap_token_exchange.scopes_supported.join(" ") ||
      RUNTIME_BOOTSTRAP_SCOPE_STRING,
  });

  return {
    ...auth,
    accessToken,
  };
}

/**
 * Register the host with Zentity (idempotent).
 * On first call, generates an Ed25519 keypair and creates a host record.
 * On subsequent calls, returns the existing host ID.
 */
export async function ensureHostRegistered(
  zentityUrl: string,
  auth: OAuthSessionContext,
  hostName: string,
  keyNamespace = buildSdkHostKeyNamespace(auth)
): Promise<string> {
  const agentConfiguration = await discoverAgentConfiguration(zentityUrl);
  const hostKey = await getOrCreateHostKey(zentityUrl, keyNamespace);

  if (hostKey.hostId) {
    return hostKey.hostId;
  }

  const registeredHost = await registerHost({
    accessToken: auth.accessToken,
    dpopClient: await createDpopClientFromKeyPair(auth.dpopKey),
    endpoint: agentConfiguration.host_registration_endpoint,
    hostKey,
    hostName,
  });
  hostKey.did = registeredHost.did;
  hostKey.hostId = registeredHost.hostId;
  saveHostKey(zentityUrl, keyNamespace, hostKey);
  console.error(
    `[agent] Host registered: ${registeredHost.hostId} (${registeredHost.created ? "new" : "existing"}, ${registeredHost.attestationTier})`
  );
  return registeredHost.hostId;
}

export function clearCachedHostId(
  zentityUrl: string,
  keyNamespace: string
): void {
  clearHostId(zentityUrl, keyNamespace);
}

/**
 * Register a fresh agent session for the current process.
 * Generates a fresh Ed25519 keypair (in-memory only) and registers with Zentity.
 */
export async function registerAgentSession(
  zentityUrl: string,
  auth: OAuthSessionContext,
  hostId: string,
  display: AgentInfo,
  keyNamespace = buildSdkHostKeyNamespace(auth)
): Promise<AgentRuntimeState> {
  const agentConfiguration = await discoverAgentConfiguration(zentityUrl);
  const hostKey = loadHostKey(zentityUrl, keyNamespace);
  if (!hostKey) {
    throw new Error("Host key not found — call ensureHostRegistered first");
  }

  const registeredSession = await registerSdkAgentSession({
    accessToken: auth.accessToken,
    display,
    dpopClient: await createDpopClientFromKeyPair(auth.dpopKey),
    endpoint: agentConfiguration.registration_endpoint,
    hostId,
    hostKey,
    requestedCapabilities: REQUESTED_CAPABILITIES,
  });

  if (registeredSession.grants.length) {
    const active = registeredSession.grants
      .filter((grant) => grant.status === "active")
      .map((grant) => grant.capability);
    const pending = registeredSession.grants
      .filter((grant) => grant.status === "pending")
      .map((grant) => grant.capability);
    console.error(
      `[agent] Session registered: ${registeredSession.sessionId} (${registeredSession.status}), ` +
        `grants: ${active.length} active [${active.join(", ")}], ${pending.length} pending [${pending.join(", ")}]`
    );
  } else {
    console.error(
      `[agent] Session registered: ${registeredSession.sessionId} (${registeredSession.status})`
    );
  }

  return registeredSession;
}

/**
 * Sign an agent assertion JWT for a CIBA request.
 * Proves the caller possesses the session's Ed25519 private key.
 */
export function signAgentAssertion(
  agent: AgentRuntimeState,
  bindingMessage: string
): Promise<string> {
  return signSdkAgentAssertion({
    bindingMessage,
    hostId: agent.hostId,
    sessionId: agent.sessionId,
    sessionPrivateKey: agent.sessionPrivateKey,
  });
}
