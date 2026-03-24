import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import type { AgentInfo } from "../agent.js";
import { config } from "../config.js";
import { discoverAgentConfiguration } from "./agent-configuration.js";
import {
  registerHostRequestSchema,
  registerHostResponseSchema,
  registerSessionRequestSchema,
  registerSessionResponseSchema,
} from "./agent-registration-contract.js";
import { RUNTIME_BOOTSTRAP_SCOPE_STRING } from "./bootstrap-scopes.js";
import type { OAuthSessionContext } from "./context.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";
import {
  clearHostId,
  getOrCreateHostKey,
  loadHostKey,
  saveHostKey,
} from "./host-key.js";
import type { AgentRuntimeState } from "./runtime-manager.js";
import { exchangeToken } from "./token-exchange.js";

const REQUESTED_CAPABILITIES = [
  "purchase",
  "read_profile",
  "check_compliance",
  "request_approval",
];

export class AgentRegistrationError extends Error {
  readonly responseBody: string;
  readonly status: number;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = "AgentRegistrationError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export function buildHostKeyNamespace(
  auth: Pick<OAuthSessionContext, "accountSub" | "clientId">
): string {
  return auth.accountSub
    ? `${auth.clientId}:${auth.accountSub}`
    : auth.clientId;
}

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

async function postJsonWithDpopRetry(
  url: string,
  auth: OAuthSessionContext,
  payload: unknown
): Promise<Response> {
  const body = JSON.stringify(payload);

  let dpopProof = await createDpopProof(
    auth.dpopKey,
    "POST",
    url,
    auth.accessToken
  );

  let response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `DPoP ${auth.accessToken}`,
      DPoP: dpopProof,
    },
    body,
  });

  const nonce = extractDpopNonce(response);
  if (nonce && (response.status === 400 || response.status === 401)) {
    dpopProof = await createDpopProof(
      auth.dpopKey,
      "POST",
      url,
      auth.accessToken,
      nonce
    );
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${auth.accessToken}`,
        DPoP: dpopProof,
      },
      body,
    });
  }

  return response;
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
  keyNamespace = buildHostKeyNamespace(auth)
): Promise<string> {
  const agentConfiguration = await discoverAgentConfiguration(zentityUrl);
  const hostKey = await getOrCreateHostKey(zentityUrl, keyNamespace);

  // Already registered — return cached host ID
  if (hostKey.hostId) {
    return hostKey.hostId;
  }

  const url = agentConfiguration.host_registration_endpoint;
  const response = await postJsonWithDpopRetry(
    url,
    auth,
    registerHostRequestSchema.parse({
      publicKey: JSON.stringify(hostKey.publicKey),
      name: hostName,
    })
  );
  if (!response.ok) {
    const text = await response.text();
    throw new AgentRegistrationError(
      `Host registration failed: ${response.status} ${text}`,
      response.status,
      text
    );
  }

  const data = registerHostResponseSchema.parse(await response.json());
  hostKey.hostId = data.hostId;
  saveHostKey(zentityUrl, keyNamespace, hostKey);
  console.error(
    `[agent] Host registered: ${data.hostId} (${data.created ? "new" : "existing"})`
  );
  return data.hostId;
}

export function clearCachedHostId(
  zentityUrl: string,
  keyNamespace: string
): void {
  clearHostId(zentityUrl, keyNamespace);
}

/**
 * Sign a host JWT for agent registration.
 * The JWT proves the caller possesses the host's Ed25519 private key.
 */
async function signHostJwt(
  hostKey: Awaited<ReturnType<typeof getOrCreateHostKey>>,
  hostId: string
): Promise<string> {
  const privateKey = await importJWK(hostKey.privateKey, "EdDSA");
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "host-attestation+jwt" })
    .setIssuer(hostId)
    .setSubject("agent-registration")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);
}

/**
 * Register a fresh agent session for the current process.
 * Generates a fresh Ed25519 keypair (in-memory only) and registers with Zentity.
 */
export async function registerAgent(
  zentityUrl: string,
  auth: OAuthSessionContext,
  hostId: string,
  display: AgentInfo,
  keyNamespace = buildHostKeyNamespace(auth)
): Promise<AgentRuntimeState> {
  const agentConfiguration = await discoverAgentConfiguration(zentityUrl);
  const hostKey = loadHostKey(zentityUrl, keyNamespace);
  if (!hostKey) {
    throw new Error("Host key not found — call ensureHostRegistered first");
  }

  // Generate ephemeral agent keypair (private key retained for JWT signing)
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const agentPrivateJwk = await exportJWK(privateKey);
  const agentPublicJwk = await exportJWK(publicKey);

  const hostJwt = await signHostJwt(hostKey, hostId);

  const url = agentConfiguration.registration_endpoint;
  const response = await postJsonWithDpopRetry(
    url,
    auth,
    registerSessionRequestSchema.parse({
      hostJwt,
      agentPublicKey: JSON.stringify(agentPublicJwk),
      requestedCapabilities: REQUESTED_CAPABILITIES,
      display,
    })
  );

  if (!response.ok) {
    const text = await response.text();
    throw new AgentRegistrationError(
      `Agent registration failed: ${response.status} ${text}`,
      response.status,
      text
    );
  }

  const data = registerSessionResponseSchema.parse(await response.json());
  if (data.grants?.length) {
    const active = data.grants
      .filter((grant) => grant.status === "active")
      .map((grant) => grant.capability);
    const pending = data.grants
      .filter((grant) => grant.status === "pending")
      .map((grant) => grant.capability);
    console.error(
      `[agent] Session registered: ${data.sessionId} (${data.status}), ` +
        `grants: ${active.length} active [${active.join(", ")}], ${pending.length} pending [${pending.join(", ")}]`
    );
  } else {
    console.error(
      `[agent] Session registered: ${data.sessionId} (${data.status})`
    );
  }

  return {
    display,
    grants: data.grants ?? [],
    hostId,
    sessionId: data.sessionId,
    sessionPrivateKey: agentPrivateJwk,
    sessionPublicKey: agentPublicJwk,
  };
}

/**
 * Sign an agent assertion JWT for a CIBA request.
 * Proves the caller possesses the session's Ed25519 private key.
 */
export async function signAgentAssertion(
  agent: AgentRuntimeState,
  bindingMessage: string
): Promise<string> {
  const privateKey = await importJWK(agent.sessionPrivateKey, "EdDSA");
  const hashHex = await sha256Hex(bindingMessage);
  const taskId = randomUUID();

  return new SignJWT({
    host_id: agent.hostId,
    task_hash: hashHex,
    task_id: taskId,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent-assertion+jwt" })
    .setIssuer(agent.sessionId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
