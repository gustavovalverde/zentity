import "server-only";

import crypto, { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

import type { TrustTier } from "@/data/aether";
import {
  buildAgentRuntimePartitionKey,
  type PersistedTrustTier,
} from "@/lib/agent-runtime-storage";
import { signAttestationHeaders } from "@/lib/attestation";
import { getDb } from "@/lib/db/connection";
import { account, agentRuntime, oauthDpopKey } from "@/lib/db/schema";
import type { ProviderId } from "@/lib/dcr";
import { readDcrClient } from "@/lib/dcr";
import { createPersistentDpopClient } from "@/lib/dpop";
import { env } from "@/lib/env";

const HOST_NAME = "Aether Demo RP";
const DISPLAY = {
  model: "gpt-4",
  name: "Aether AI",
  runtime: "demo-rp",
  version: "1.0",
} as const;
const REQUESTED_CAPABILITIES = ["purchase", "request_approval"] as const;

type AgentRuntimeRow = typeof agentRuntime.$inferSelect;
type HostAttestationTier = "attested" | "self-declared" | "unverified";

interface EnsureHostRegistrationOptions {
  attestationHeaders?: Record<string, string>;
  requiredAttestationTier?: HostAttestationTier;
}

interface RegisterAgentSessionOptions {
  force?: boolean;
}

function hasRegisteredSession(
  runtime: AgentRuntimeRow
): runtime is AgentRuntimeRow & {
  sessionId: string;
  sessionPrivateJwk: string;
  sessionPublicJwk: string;
} {
  return Boolean(
    runtime.sessionId && runtime.sessionPrivateJwk && runtime.sessionPublicJwk
  );
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function generateEd25519Jwks() {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  return {
    privateJwk: await exportJWK(privateKey),
    publicJwk: await exportJWK(publicKey),
  };
}

async function getAccountForProvider(userId: string, providerId: ProviderId) {
  return getDb().query.account.findFirst({
    where: and(
      eq(account.userId, userId),
      eq(account.providerId, `zentity-${providerId}`)
    ),
    columns: {
      accessToken: true,
      accessTokenExpiresAt: true,
    },
  });
}

async function getDpopKey(providerId: ProviderId, accessToken: string) {
  return getDb().query.oauthDpopKey.findFirst({
    where: and(
      eq(oauthDpopKey.providerId, providerId),
      eq(oauthDpopKey.accessToken, accessToken)
    ),
  });
}

async function getOrCreateAgentRuntime(
  userId: string,
  providerId: ProviderId,
  trustTier: PersistedTrustTier
): Promise<AgentRuntimeRow> {
  const runtimeKey = buildAgentRuntimePartitionKey(providerId, trustTier);
  const existing = await getDb().query.agentRuntime.findFirst({
    where: and(
      eq(agentRuntime.userId, userId),
      eq(agentRuntime.providerId, runtimeKey)
    ),
  });
  if (existing) {
    return existing;
  }

  const hostKeys = await generateEd25519Jwks();
  const [created] = await getDb()
    .insert(agentRuntime)
    .values({
      id: randomUUID(),
      userId,
      providerId: runtimeKey,
      displayName: DISPLAY.name,
      runtime: DISPLAY.runtime,
      model: DISPLAY.model,
      version: DISPLAY.version,
      hostPublicJwk: JSON.stringify(hostKeys.publicJwk),
      hostPrivateJwk: JSON.stringify(hostKeys.privateJwk),
      updatedAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new Error("Failed to initialize agent runtime");
  }

  return created;
}

async function postJsonWithDpop(
  url: string,
  accessToken: string,
  providerId: ProviderId,
  payload: unknown,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const dpopRow = await getDpopKey(providerId, accessToken);
  if (!dpopRow) {
    throw new Error("Missing persisted DPoP key for the current OAuth session");
  }

  const dpop = await createPersistentDpopClient({
    privateJwk: JSON.parse(dpopRow.privateJwk),
    publicJwk: JSON.parse(dpopRow.publicJwk),
  });
  const body = JSON.stringify(payload);

  const attempt = async (nonce?: string) => {
    const proof = await dpop.proofFor("POST", url, accessToken, nonce);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${accessToken}`,
        DPoP: proof,
        ...extraHeaders,
      },
      body,
    });
    return { response, result: response };
  };

  const { response } = await dpop.withNonceRetry(attempt);
  return response;
}

async function ensureHostRegistered(
  runtime: AgentRuntimeRow,
  userId: string,
  providerId: ProviderId,
  options?: EnsureHostRegistrationOptions
): Promise<AgentRuntimeRow> {
  const authAccount = await getAccountForProvider(userId, providerId);
  if (!authAccount?.accessToken) {
    throw new Error("Missing OAuth access token. Sign in again.");
  }

  if (
    authAccount.accessTokenExpiresAt &&
    new Date(authAccount.accessTokenExpiresAt).getTime() <= Date.now()
  ) {
    throw new Error("OAuth access token expired. Sign in again.");
  }

  const client = await readDcrClient(providerId);
  if (!client) {
    throw new Error("Client not registered. Register the demo client first.");
  }

  const response = await postJsonWithDpop(
    `${env.ZENTITY_URL}/api/auth/agent/register-host`,
    authAccount.accessToken,
    providerId,
    {
      publicKey: runtime.hostPublicJwk,
      name: HOST_NAME,
      clientId: client.clientId,
    },
    options?.attestationHeaders
  );
  if (!response.ok) {
    throw new Error(
      `Host registration failed: ${response.status} ${await response.text()}`
    );
  }

  const body = (await response.json()) as {
    attestation_tier?: HostAttestationTier;
    hostId: string;
  };
  const attestationTier = body.attestation_tier ?? "unverified";

  if (
    options?.requiredAttestationTier &&
    attestationTier !== options.requiredAttestationTier
  ) {
    throw new Error(
      `Host registration did not satisfy the required ${options.requiredAttestationTier} trust tier (got ${attestationTier}).`
    );
  }

  const [updated] = await getDb()
    .update(agentRuntime)
    .set({
      hostId: body.hostId,
      updatedAt: new Date(),
    })
    .where(eq(agentRuntime.id, runtime.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to persist registered host state");
  }

  return updated;
}

async function signHostJwt(
  runtime: AgentRuntimeRow,
  hostId: string
): Promise<string> {
  const privateKey = await importJWK(
    JSON.parse(runtime.hostPrivateJwk),
    "EdDSA"
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "host-attestation+jwt" })
    .setIssuer(hostId)
    .setSubject("agent-registration")
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);
}

async function registerAgentSession(
  runtime: AgentRuntimeRow,
  userId: string,
  providerId: ProviderId,
  options?: RegisterAgentSessionOptions
): Promise<AgentRuntimeRow> {
  if (hasRegisteredSession(runtime) && !options?.force) {
    return runtime;
  }

  if (!runtime.hostId) {
    throw new Error("Host must be registered before creating an agent session");
  }

  const authAccount = await getAccountForProvider(userId, providerId);
  if (!authAccount?.accessToken) {
    throw new Error("Missing OAuth access token. Sign in again.");
  }

  const sessionKeys = await generateEd25519Jwks();
  const hostJwt = await signHostJwt(runtime, runtime.hostId);
  const response = await postJsonWithDpop(
    `${env.ZENTITY_URL}/api/auth/agent/register`,
    authAccount.accessToken,
    providerId,
    {
      hostJwt,
      agentPublicKey: JSON.stringify(sessionKeys.publicJwk),
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      display: DISPLAY,
    }
  );

  if (!response.ok) {
    throw new Error(
      `Agent registration failed: ${response.status} ${await response.text()}`
    );
  }

  const body = (await response.json()) as { sessionId: string };
  const [updated] = await getDb()
    .update(agentRuntime)
    .set({
      sessionId: body.sessionId,
      sessionPublicJwk: JSON.stringify(sessionKeys.publicJwk),
      sessionPrivateJwk: JSON.stringify(sessionKeys.privateJwk),
      updatedAt: new Date(),
    })
    .where(eq(agentRuntime.id, runtime.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to persist agent session state");
  }

  return updated;
}

export async function prepareAgentAssertionForProvider(params: {
  bindingMessage: string;
  providerId: ProviderId;
  trustTier?: TrustTier;
  userId: string;
}): Promise<string | null> {
  const tier = params.trustTier ?? "registered";

  if (tier === "anonymous") {
    return null;
  }

  let runtime = await getOrCreateAgentRuntime(
    params.userId,
    params.providerId,
    tier
  );

  if (tier === "attested") {
    const hadRegisteredSession = hasRegisteredSession(runtime);
    // Attested runtimes are partitioned from registered ones, so reusing this
    // row is safe and won't downgrade the registered session.
    const hostPublicJwk = JSON.parse(runtime.hostPublicJwk);
    const hostPrivateJwk = JSON.parse(runtime.hostPrivateJwk);
    const { attestation, attestationPop } = await signAttestationHeaders(
      hostPublicJwk,
      hostPrivateJwk,
      env.NEXT_PUBLIC_APP_URL,
      env.ZENTITY_URL
    );
    runtime = await ensureHostRegistered(
      runtime,
      params.userId,
      params.providerId,
      {
        attestationHeaders: {
          "OAuth-Client-Attestation": attestation,
          "OAuth-Client-Attestation-PoP": attestationPop,
        },
        requiredAttestationTier: "attested",
      }
    );

    // Agent sessions inherit host policies at registration time. Re-register
    // attested runtimes so a session created before attestation succeeded
    // cannot stay pinned to the weaker default policy set.
    runtime = await registerAgentSession(
      runtime,
      params.userId,
      params.providerId,
      { force: hadRegisteredSession }
    );
  } else if (!runtime.hostId) {
    runtime = await ensureHostRegistered(
      runtime,
      params.userId,
      params.providerId
    );
    runtime = await registerAgentSession(
      runtime,
      params.userId,
      params.providerId
    );
  } else {
    runtime = await registerAgentSession(
      runtime,
      params.userId,
      params.providerId
    );
  }

  if (!(runtime.sessionId && runtime.sessionPrivateJwk && runtime.hostId)) {
    throw new Error("Agent runtime is missing registered session state");
  }

  const privateKey = await importJWK(
    JSON.parse(runtime.sessionPrivateJwk),
    "EdDSA"
  );
  const taskHash = await sha256Hex(params.bindingMessage);

  return new SignJWT({
    host_id: runtime.hostId,
    task_hash: taskHash,
    task_id: randomUUID(),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "agent-assertion+jwt" })
    .setIssuer(runtime.sessionId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);
}
