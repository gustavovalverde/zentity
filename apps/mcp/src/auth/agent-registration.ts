import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import type { AgentInfo } from "../agent.js";
import type { OAuthSessionContext } from "./context.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";
import {
  clearHostId,
  getOrCreateHostKey,
  loadHostKey,
  saveHostKey,
} from "./host-key.js";
import type { AgentRuntimeState } from "./runtime-manager.js";

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
  keyNamespace = auth.clientId
): Promise<string> {
  const hostKey = await getOrCreateHostKey(zentityUrl, keyNamespace);

  // Already registered — return cached host ID
  if (hostKey.hostId) {
    return hostKey.hostId;
  }

  const url = `${zentityUrl}/api/auth/agent/register-host`;
  const response = await postJsonWithDpopRetry(url, auth, {
    publicKey: JSON.stringify(hostKey.publicKey),
    name: hostName,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new AgentRegistrationError(
      `Host registration failed: ${response.status} ${text}`,
      response.status,
      text
    );
  }

  const data = (await response.json()) as { hostId: string; created: boolean };
  hostKey.hostId = data.hostId;
  saveHostKey(zentityUrl, keyNamespace, hostKey);
  console.error(
    `[agent] Host registered: ${data.hostId} (${data.created ? "new" : "existing"})`
  );
  return data.hostId;
}

export function clearCachedHostId(zentityUrl: string, clientId: string): void {
  clearHostId(zentityUrl, clientId);
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
  keyNamespace = auth.clientId
): Promise<AgentRuntimeState> {
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

  const url = `${zentityUrl}/api/auth/agent/register`;
  const response = await postJsonWithDpopRetry(url, auth, {
    hostJwt,
    agentPublicKey: JSON.stringify(agentPublicJwk),
    requestedCapabilities: REQUESTED_CAPABILITIES,
    display,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new AgentRegistrationError(
      `Agent registration failed: ${response.status} ${text}`,
      response.status,
      text
    );
  }

  const data = (await response.json()) as {
    sessionId: string;
    grants?: Array<{ capability: string; status: string }>;
    status: string;
  };
  if (data.grants?.length) {
    const active = data.grants
      .filter((g) => g.status === "active")
      .map((g) => g.capability);
    const pending = data.grants
      .filter((g) => g.status === "pending")
      .map((g) => g.capability);
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
