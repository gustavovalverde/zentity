import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import {
  encodeEd25519DidKeyFromJwk,
  type HostAttestationTier,
} from "./protocol/index";
import type { DpopClient } from "./rp/dpop-client";

export interface AgentDisplay {
  model?: string;
  name: string;
  runtime?: string;
  version?: string;
}

export interface AgentSessionGrant {
  capability: string;
  status: string;
}

export interface HostKeyMaterial {
  did?: string;
  hostId?: string;
  privateKey: JWK;
  publicKey: JWK;
}

export interface RegisteredHost {
  attestationTier: HostAttestationTier;
  created: boolean;
  did: string;
  hostId: string;
}

export interface RegisteredAgentSession {
  display: AgentDisplay;
  grants: AgentSessionGrant[];
  hostId: string;
  sessionDid: string;
  sessionId: string;
  sessionPrivateKey: JWK;
  sessionPublicKey: JWK;
  status: string;
}

export interface RegisterHostOptions {
  accessToken: string;
  clientAttestationJwt?: string;
  clientAttestationPopJwt?: string;
  dpopClient: Pick<DpopClient, "proofFor" | "withNonceRetry">;
  endpoint: string | URL;
  fetch?: typeof globalThis.fetch;
  hostKey: HostKeyMaterial;
  hostName: string;
}

export interface RegisterAgentSessionOptions {
  accessToken: string;
  display: AgentDisplay;
  dpopClient: Pick<DpopClient, "proofFor" | "withNonceRetry">;
  endpoint: string | URL;
  fetch?: typeof globalThis.fetch;
  hostId: string;
  hostKey: HostKeyMaterial;
  requestedCapabilities?: string[];
}

export interface SignAgentAssertionOptions {
  bindingMessage: string;
  hostId: string;
  jti?: string;
  sessionId: string;
  sessionPrivateKey: JWK;
  taskId?: string;
}

interface RegisterHostResponseBody {
  attestation_tier: HostAttestationTier;
  created: boolean;
  did: string;
  hostId: string;
}

interface RegisterSessionResponseBody {
  did: string;
  grants: AgentSessionGrant[];
  sessionId: string;
  status: string;
}

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

export function buildHostKeyNamespace(auth: {
  accountSub?: string | undefined;
  clientId: string;
}): string {
  return auth.accountSub
    ? `${auth.clientId}:${auth.accountSub}`
    : auth.clientId;
}

function toUrlString(url: string | URL): string {
  return url instanceof URL ? url.toString() : url;
}

function readRecord(candidate: unknown, name: string): Record<string, unknown> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${name} must be an object`);
  }
  return candidate as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const field = record[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`Agent registration response missing ${key}`);
  }
  return field;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const field = record[key];
  if (typeof field !== "boolean") {
    throw new Error(`Agent registration response missing ${key}`);
  }
  return field;
}

function readHostAttestationTier(tier: unknown): HostAttestationTier {
  if (
    tier === "attested" ||
    tier === "self-declared" ||
    tier === "unverified"
  ) {
    return tier;
  }
  throw new Error("Agent registration response missing attestation_tier");
}

function readSessionGrants(grants: unknown): AgentSessionGrant[] {
  if (!Array.isArray(grants)) {
    return [];
  }

  return grants.map((grant) => {
    const record = readRecord(grant, "grant");
    return {
      capability: readString(record, "capability"),
      status: readString(record, "status"),
    };
  });
}

function parseRegisterHostResponse(body: unknown): RegisterHostResponseBody {
  const record = readRecord(body, "host registration response");
  return {
    hostId: readString(record, "hostId"),
    did: readString(record, "did"),
    created: readBoolean(record, "created"),
    attestation_tier: readHostAttestationTier(record.attestation_tier),
  };
}

function parseRegisterSessionResponse(
  body: unknown
): RegisterSessionResponseBody {
  const record = readRecord(body, "session registration response");
  return {
    did: readString(record, "did"),
    sessionId: readString(record, "sessionId"),
    status: readString(record, "status"),
    grants: readSessionGrants(record.grants),
  };
}

async function parseJsonText(text: string): Promise<unknown> {
  return text ? JSON.parse(text) : {};
}

async function postJsonWithDpopRetry(input: {
  accessToken: string;
  body: unknown;
  dpopClient: Pick<DpopClient, "proofFor" | "withNonceRetry">;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string | undefined>;
  url: string | URL;
}): Promise<Response> {
  const url = toUrlString(input.url);
  const body = JSON.stringify(input.body);
  const fetchFn = input.fetch ?? fetch;

  const { response } = await input.dpopClient.withNonceRetry(async (nonce) => {
    const dpopProof = await input.dpopClient.proofFor(
      "POST",
      url,
      input.accessToken,
      nonce
    );
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${input.accessToken}`,
        DPoP: dpopProof,
        ...input.headers,
      },
      body,
    });

    return { response, result: undefined };
  });

  return response;
}

async function readRegistrationResponse(
  response: Response,
  failurePrefix: string
): Promise<unknown> {
  const responseBody = await response.text();
  if (!response.ok) {
    throw new AgentRegistrationError(
      `${failurePrefix}: ${response.status} ${responseBody}`,
      response.status,
      responseBody
    );
  }

  return parseJsonText(responseBody);
}

function buildHostRegistrationRequest(hostKey: HostKeyMaterial, name: string) {
  return {
    did: hostKey.did ?? encodeEd25519DidKeyFromJwk(hostKey.publicKey),
    name,
  };
}

function buildSessionRegistrationRequest(input: {
  display: AgentDisplay;
  hostJwt: string;
  requestedCapabilities: string[] | undefined;
  sessionDid: string;
}) {
  return {
    hostJwt: input.hostJwt,
    did: input.sessionDid,
    ...(input.requestedCapabilities
      ? { requestedCapabilities: input.requestedCapabilities }
      : {}),
    display: input.display,
  };
}

export async function registerHost(
  options: RegisterHostOptions
): Promise<RegisteredHost> {
  const response = await postJsonWithDpopRetry({
    accessToken: options.accessToken,
    dpopClient: options.dpopClient,
    url: options.endpoint,
    body: buildHostRegistrationRequest(options.hostKey, options.hostName),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    headers: {
      ...(options.clientAttestationJwt
        ? { "OAuth-Client-Attestation": options.clientAttestationJwt }
        : {}),
      ...(options.clientAttestationPopJwt
        ? { "OAuth-Client-Attestation-PoP": options.clientAttestationPopJwt }
        : {}),
    },
  });

  const hostResponse = parseRegisterHostResponse(
    await readRegistrationResponse(response, "Host registration failed")
  );
  return {
    hostId: hostResponse.hostId,
    did: hostResponse.did,
    created: hostResponse.created,
    attestationTier: hostResponse.attestation_tier,
  };
}

export async function signHostAttestationJwt(
  hostKey: Pick<HostKeyMaterial, "privateKey">,
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

export async function registerAgentSession(
  options: RegisterAgentSessionOptions
): Promise<RegisteredAgentSession> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const sessionPrivateKey = await exportJWK(privateKey);
  const sessionPublicKey = await exportJWK(publicKey);
  const sessionDid = encodeEd25519DidKeyFromJwk(sessionPublicKey);
  const hostJwt = await signHostAttestationJwt(options.hostKey, options.hostId);

  const response = await postJsonWithDpopRetry({
    accessToken: options.accessToken,
    dpopClient: options.dpopClient,
    url: options.endpoint,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    body: buildSessionRegistrationRequest({
      display: options.display,
      hostJwt,
      requestedCapabilities: options.requestedCapabilities,
      sessionDid,
    }),
  });

  const sessionResponse = parseRegisterSessionResponse(
    await readRegistrationResponse(response, "Agent registration failed")
  );

  return {
    display: options.display,
    grants: sessionResponse.grants,
    hostId: options.hostId,
    sessionDid: sessionResponse.did,
    sessionId: sessionResponse.sessionId,
    sessionPrivateKey,
    sessionPublicKey,
    status: sessionResponse.status,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signAgentAssertion(
  options: SignAgentAssertionOptions
): Promise<string> {
  const privateKey = await importJWK(options.sessionPrivateKey, "EdDSA");
  const taskHash = await sha256Hex(options.bindingMessage);

  return new SignJWT({
    host_id: options.hostId,
    task_hash: taskHash,
    task_id: options.taskId ?? crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent-assertion+jwt" })
    .setIssuer(options.sessionId)
    .setJti(options.jti ?? crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);
}
