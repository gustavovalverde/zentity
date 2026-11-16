import { bytesToHex } from "@noble/curves/utils.js";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import { z } from "zod";
import { HOST_ATTESTATION_TIERS } from "./protocol/claims";
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
  dpopClient: Pick<DpopClient, "fetch">;
  endpoint: string | URL;
  fetch?: typeof globalThis.fetch;
  hostKey: HostKeyMaterial;
  hostName: string;
}

export interface RegisterAgentSessionOptions {
  accessToken: string;
  display: AgentDisplay;
  dpopClient: Pick<DpopClient, "fetch">;
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

const nonEmptyString = z.string().min(1);

const registerHostResponseSchema = z.object({
  attestation_tier: z.enum(HOST_ATTESTATION_TIERS),
  created: z.boolean(),
  did: nonEmptyString,
  hostId: nonEmptyString,
});

const registerSessionResponseSchema = z.object({
  did: nonEmptyString,
  // A non-array `grants` means no grants; a malformed entry is an error.
  grants: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.object({ capability: nonEmptyString, status: nonEmptyString }))
  ),
  sessionId: nonEmptyString,
  status: nonEmptyString,
});

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

function parseRegistrationResponse<T extends z.ZodType>(
  schema: T,
  body: unknown,
  name: string
): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(`Invalid ${name}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

async function parseJsonText(text: string): Promise<unknown> {
  return text ? JSON.parse(text) : {};
}

function postJsonWithDpop(input: {
  accessToken: string;
  body: unknown;
  dpopClient: Pick<DpopClient, "fetch">;
  fetch?: typeof globalThis.fetch | undefined;
  headers?: Record<string, string>;
  url: string | URL;
}): Promise<Response> {
  return input.dpopClient.fetch(input.url, {
    method: "POST",
    accessToken: input.accessToken,
    headers: { "Content-Type": "application/json", ...input.headers },
    body: JSON.stringify(input.body),
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });
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
  const response = await postJsonWithDpop({
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

  const hostResponse = parseRegistrationResponse(
    registerHostResponseSchema,
    await readRegistrationResponse(response, "Host registration failed"),
    "host registration response"
  );
  return {
    hostId: hostResponse.hostId,
    did: hostResponse.did,
    created: hostResponse.created,
    attestationTier: hostResponse.attestation_tier,
  };
}

async function signHostAttestationJwt(
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

  const response = await postJsonWithDpop({
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

  const sessionResponse = parseRegistrationResponse(
    registerSessionResponseSchema,
    await readRegistrationResponse(response, "Agent registration failed"),
    "session registration response"
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
  return bytesToHex(new Uint8Array(digest));
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
