import "server-only";

import { randomUUID } from "node:crypto";

import {
  AgentRegistrationError,
  type HostAttestationTier,
  type RegisteredAgentSession,
  type RegisteredHost,
  registerHost,
  registerAgentSession as registerSdkAgentSession,
  signAgentAssertion,
} from "@zentity/sdk";
import { PAYMENT_AUTHORIZATION_CAPABILITY } from "@zentity/sdk/protocol";
import {
  createDpopClientFromKeyPair,
  requestTokenEndpoint,
} from "@zentity/sdk/rp";
import { and, eq } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";

import {
  buildAgentRuntimePartitionKey,
  type PersistedTrustTier,
  type TrustTier,
} from "@/lib/agent-runtime-storage";
import { signAttestationHeaders } from "@/lib/attestation";
import { getDb } from "@/lib/db/connection";
import { account, agentRuntime, oauthDpopKey } from "@/lib/db/schema";
import { readDcrClient } from "@/lib/dcr";
import { env } from "@/lib/env";
import {
  getOAuthProviderId,
  type RouteScenarioId,
} from "@/scenarios/route-scenario-registry";

const HOST_NAME = "Aether Demo RP";
const AGENT_BOOTSTRAP_SCOPE = "agent:host.register agent:session.register";
const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
const TOKEN_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";
const DISPLAY = {
  model: "gpt-4",
  name: "Aether AI",
  runtime: "demo-rp",
  version: "1.0",
} as const;
const REQUESTED_CAPABILITIES = [PAYMENT_AUTHORIZATION_CAPABILITY] as const;

type AgentRuntimeRow = typeof agentRuntime.$inferSelect;

interface EnsureHostRegistrationOptions {
  clientAttestationJwt?: string;
  clientAttestationPopJwt?: string;
  requiredAttestationTier?: HostAttestationTier;
}

interface RegisterAgentSessionOptions {
  force?: boolean;
}

interface BootstrapAccessContext {
  accessToken: string;
  dpop: Awaited<ReturnType<typeof createDpopClientFromKeyPair>>;
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

function isExpired(timestamp: string | null | undefined): boolean {
  if (!timestamp) {
    return false;
  }

  return new Date(timestamp).getTime() <= Date.now();
}

function buildReauthError() {
  return new Error(
    "OAuth access token expired or is no longer valid. Sign in again."
  );
}

function getAccountForScenario(userId: string, scenarioId: RouteScenarioId) {
  return getDb().query.account.findFirst({
    where: and(
      eq(account.userId, userId),
      eq(account.providerId, getOAuthProviderId(scenarioId))
    ),
    columns: {
      accessToken: true,
      accessTokenExpiresAt: true,
    },
  });
}

function getDpopKey(scenarioId: RouteScenarioId, accessToken: string) {
  return getDb().query.oauthDpopKey.findFirst({
    where: and(
      eq(oauthDpopKey.oauthProviderId, getOAuthProviderId(scenarioId)),
      eq(oauthDpopKey.accessToken, accessToken)
    ),
  });
}

async function getPersistedDpopClient(
  scenarioId: RouteScenarioId,
  accessToken: string
) {
  const dpopRow = await getDpopKey(scenarioId, accessToken);
  if (!dpopRow) {
    throw new Error("Missing persisted DPoP key for the current OAuth session");
  }

  return createDpopClientFromKeyPair({
    privateJwk: JSON.parse(dpopRow.privateJwk),
    publicJwk: JSON.parse(dpopRow.publicJwk),
  });
}

async function getOrCreateAgentRuntime(
  userId: string,
  scenarioId: RouteScenarioId,
  trustTier: PersistedTrustTier
): Promise<AgentRuntimeRow> {
  const runtimeKey = buildAgentRuntimePartitionKey(scenarioId, trustTier);
  const existing = await getDb().query.agentRuntime.findFirst({
    where: and(
      eq(agentRuntime.userId, userId),
      eq(agentRuntime.runtimePartitionKey, runtimeKey)
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
      runtimePartitionKey: runtimeKey,
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

async function exchangeBootstrapAccessToken(
  userId: string,
  scenarioId: RouteScenarioId
): Promise<BootstrapAccessContext> {
  const [authAccount, client] = await Promise.all([
    getAccountForScenario(userId, scenarioId),
    readDcrClient(scenarioId),
  ]);
  if (!authAccount?.accessToken) {
    throw new Error("Missing OAuth access token. Sign in again.");
  }

  if (isExpired(authAccount.accessTokenExpiresAt)) {
    throw buildReauthError();
  }

  if (!client) {
    throw new Error("Client not registered. Register the demo client first.");
  }

  const dpop = await getPersistedDpopClient(
    scenarioId,
    authAccount.accessToken
  );
  const tokenUrl = `${env.ZENTITY_URL}/api/auth/oauth2/token`;

  const { body, response } = await requestTokenEndpoint(
    dpop,
    tokenUrl,
    new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: authAccount.accessToken,
      subject_token_type: TOKEN_TYPE_ACCESS_TOKEN,
      client_id: client.clientId,
      audience: env.ZENTITY_URL,
      scope: AGENT_BOOTSTRAP_SCOPE,
    })
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw buildReauthError();
    }

    throw new Error(
      `Bootstrap token exchange failed: ${response.status} ${JSON.stringify(body ?? {})}`
    );
  }

  const accessToken = (body as Record<string, unknown> | undefined)
    ?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Bootstrap token exchange did not return an access token");
  }

  return {
    accessToken,
    dpop,
  };
}

async function ensureHostRegistered(
  runtime: AgentRuntimeRow,
  bootstrap: BootstrapAccessContext,
  options?: EnsureHostRegistrationOptions
): Promise<AgentRuntimeRow> {
  let registeredHost: RegisteredHost;
  try {
    registeredHost = await registerHost({
      accessToken: bootstrap.accessToken,
      dpopClient: bootstrap.dpop,
      endpoint: `${env.ZENTITY_URL}/api/auth/agent/host/register`,
      hostKey: {
        privateKey: JSON.parse(runtime.hostPrivateJwk),
        publicKey: JSON.parse(runtime.hostPublicJwk),
      },
      hostName: HOST_NAME,
      ...(options?.clientAttestationJwt
        ? { clientAttestationJwt: options.clientAttestationJwt }
        : {}),
      ...(options?.clientAttestationPopJwt
        ? { clientAttestationPopJwt: options.clientAttestationPopJwt }
        : {}),
    });
  } catch (error) {
    if (error instanceof AgentRegistrationError && error.status === 401) {
      throw buildReauthError();
    }
    throw error;
  }

  if (
    options?.requiredAttestationTier &&
    registeredHost.attestationTier !== options.requiredAttestationTier
  ) {
    throw new Error(
      `Host registration did not satisfy the required ${options.requiredAttestationTier} trust tier (got ${registeredHost.attestationTier}).`
    );
  }

  const [updated] = await getDb()
    .update(agentRuntime)
    .set({
      hostId: registeredHost.hostId,
      updatedAt: new Date(),
    })
    .where(eq(agentRuntime.id, runtime.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to persist registered host state");
  }

  return updated;
}

async function registerAgentSession(
  runtime: AgentRuntimeRow,
  bootstrap: BootstrapAccessContext,
  options?: RegisterAgentSessionOptions
): Promise<AgentRuntimeRow> {
  if (hasRegisteredSession(runtime) && !options?.force) {
    return runtime;
  }

  if (!runtime.hostId) {
    throw new Error("Host must be registered before creating an agent session");
  }

  let registeredSession: RegisteredAgentSession;
  try {
    registeredSession = await registerSdkAgentSession({
      accessToken: bootstrap.accessToken,
      display: DISPLAY,
      dpopClient: bootstrap.dpop,
      endpoint: `${env.ZENTITY_URL}/api/auth/agent/register`,
      hostId: runtime.hostId,
      hostKey: {
        privateKey: JSON.parse(runtime.hostPrivateJwk),
        publicKey: JSON.parse(runtime.hostPublicJwk),
      },
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
    });
  } catch (error) {
    if (error instanceof AgentRegistrationError && error.status === 401) {
      throw buildReauthError();
    }
    throw error;
  }

  const [updated] = await getDb()
    .update(agentRuntime)
    .set({
      sessionId: registeredSession.sessionId,
      sessionPublicJwk: JSON.stringify(registeredSession.sessionPublicKey),
      sessionPrivateJwk: JSON.stringify(registeredSession.sessionPrivateKey),
      updatedAt: new Date(),
    })
    .where(eq(agentRuntime.id, runtime.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to persist agent session state");
  }

  return updated;
}

export async function prepareAgentAssertionForScenario(params: {
  bindingMessage: string;
  scenarioId: RouteScenarioId;
  trustTier?: TrustTier;
  userId: string;
}): Promise<string | null> {
  const tier = params.trustTier ?? "registered";

  if (tier === "anonymous") {
    return null;
  }

  let runtime = await getOrCreateAgentRuntime(
    params.userId,
    params.scenarioId,
    tier
  );
  const bootstrap = await exchangeBootstrapAccessToken(
    params.userId,
    params.scenarioId
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
    runtime = await ensureHostRegistered(runtime, bootstrap, {
      clientAttestationJwt: attestation,
      clientAttestationPopJwt: attestationPop,
      requiredAttestationTier: "attested",
    });

    // Agent sessions inherit host policies at registration time. Re-register
    // attested runtimes so a session created before attestation succeeded
    // cannot stay pinned to the weaker default policy set.
    runtime = await registerAgentSession(runtime, bootstrap, {
      force: hadRegisteredSession,
    });
  } else if (runtime.hostId) {
    runtime = await registerAgentSession(runtime, bootstrap);
  } else {
    runtime = await ensureHostRegistered(runtime, bootstrap);
    runtime = await registerAgentSession(runtime, bootstrap);
  }

  if (!(runtime.sessionId && runtime.sessionPrivateJwk && runtime.hostId)) {
    throw new Error("Agent runtime is missing registered session state");
  }

  return signAgentAssertion({
    bindingMessage: params.bindingMessage,
    hostId: runtime.hostId,
    sessionId: runtime.sessionId,
    sessionPrivateKey: JSON.parse(runtime.sessionPrivateJwk),
  });
}
