import {
  type CibaPendingApproval,
  type CibaRequest,
  type CibaTokenSet,
  requestCibaApproval,
} from "./ciba";
import { stableStringify } from "./fpa/client";
import { createDiscoveryResolver } from "./fpa/discovery";
import type { TaskHashInput } from "./protocol/authorization-details";
import { truncateBindingMessage } from "./protocol/binding-message";
import type { DpopClient } from "./rp/dpop-client";
import {
  identityStrengthTier,
  requestProofOfHumanToken,
} from "./rp/proof-of-human";
import {
  createX402Fetch,
  type X402Fetch,
  type X402FetchOptions,
} from "./x402";

const PURCHASE_CAPABILITY = "purchase";
const POH_SCOPE = "openid poh";

export interface AgentConfig {
  clientId: string;
  dpopClient: DpopClient;
  fetch?: typeof globalThis.fetch;
  issuerUrl: string | URL;
  loginHint?: string;
  onPendingApproval?:
    | ((pending: CibaPendingApproval) => Promise<void> | void)
    | undefined;
  proofOfHumanUrl?: string | URL;
  resource?: string;
  /**
   * Signs an Agent-Assertion for the registered agent session, for example
   * with `signAgentAssertion`. Called with each request as it will be sent,
   * so the assertion's `task_hash` covers that exact request.
   */
  signAgentAssertion?: ((request: TaskHashInput) => Promise<string>) | undefined;
}

export interface RequestApprovalOptions {
  authorizationDetails?: unknown[];
  bindingMessage: string;
  loginHint?: string;
  resource?: string;
  scope: string;
}

export interface RequestCapabilityOptions extends RequestApprovalOptions {
  action: string;
  audience: string;
}

export interface ProveHumanOptions {
  audience: string;
  authorizationDetails?: unknown[];
  bindingMessage?: string;
  minComplianceLevel?: number;
  resource?: string;
  scope?: string;
}

export interface Agent {
  fetch: X402Fetch;
  proveHuman(options: ProveHumanOptions): Promise<string>;
  requestApproval(options: RequestApprovalOptions): Promise<CibaTokenSet>;
  requestCapability(options: RequestCapabilityOptions): Promise<CibaTokenSet>;
}

export class ComplianceInsufficientError extends Error {
  readonly actualLevel: number;
  readonly requiredLevel: number;
  readonly upgradeUrl: string;

  constructor(input: {
    actualLevel: number;
    issuerUrl: string | URL;
    requiredLevel: number;
  }) {
    super(
      `Proof of human tier ${input.actualLevel} is below required tier ${input.requiredLevel}`
    );
    this.name = "ComplianceInsufficientError";
    this.actualLevel = input.actualLevel;
    this.requiredLevel = input.requiredLevel;
    this.upgradeUrl = new URL("/dashboard/verify", input.issuerUrl).toString();
  }
}

function buildCapabilityCacheKey(input: {
  action: string;
  audience: string;
  authorizationDetails?: unknown[] | undefined;
  clientId: string;
  resource: string;
  scope: string;
}): string {
  return [
    input.clientId,
    input.audience,
    input.action,
    input.scope,
    input.resource,
    stableStringify(input.authorizationDetails ?? []),
  ].join("\u0000");
}

/**
 * Whether the token set can answer later requests for `action`. Only a
 * capability grant approves more than the one request the user saw; a
 * manual approval binds exactly that request and is never reused.
 */
function reusableForCapability(
  tokenSet: CibaTokenSet,
  action: string
): boolean {
  return (
    tokenSet.oversight?.method === "capability_grant" &&
    (tokenSet.capabilities?.some(
      (capability) => capability.action === action
    ) ??
      false)
  );
}

function resolveProofOfHumanUrl(
  issuerUrl: string | URL,
  configuredUrl: string | URL | undefined
): string | URL {
  return configuredUrl ?? new URL("/api/auth/oauth2/proof-of-human", issuerUrl);
}

function resolveIssuerResource(issuerUrl: string | URL): string {
  return issuerUrl instanceof URL ? issuerUrl.origin : new URL(issuerUrl).origin;
}

function resolveAudience(input: string | URL): string {
  return input instanceof URL ? input.origin : new URL(input).origin;
}

export function createAgent(config: AgentConfig): Agent {
  const fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  const discoveryResolver = createDiscoveryResolver({
    fetch: fetchFn,
    issuerUrl: config.issuerUrl,
  });
  const capabilityTokensByKey = new Map<string, CibaTokenSet>();

  async function requestApproval(
    options: RequestApprovalOptions
  ): Promise<CibaTokenSet> {
    const discovery = await discoveryResolver.read();
    if (!discovery.backchannel_authentication_endpoint) {
      throw new Error(
        "OpenID discovery response missing backchannel_authentication_endpoint"
      );
    }

    const agentAssertion = await config.signAgentAssertion?.({
      bindingMessage: options.bindingMessage,
      scope: options.scope,
      ...(options.authorizationDetails
        ? { authorizationDetails: options.authorizationDetails }
        : {}),
    });
    const request: CibaRequest = {
      bindingMessage: options.bindingMessage,
      cibaEndpoint: discovery.backchannel_authentication_endpoint,
      clientId: config.clientId,
      dpopClient: config.dpopClient,
      fetch: fetchFn,
      loginHint: options.loginHint ?? config.loginHint ?? "",
      onPendingApproval: config.onPendingApproval,
      scope: options.scope,
      tokenEndpoint: discovery.token_endpoint,
      ...(agentAssertion ? { agentAssertion } : {}),
      ...(options.authorizationDetails
        ? { authorizationDetails: options.authorizationDetails }
        : {}),
      ...(options.resource ?? config.resource
        ? { resource: options.resource ?? config.resource }
        : {}),
    };

    if (!request.loginHint) {
      throw new Error("Agent loginHint is required for CIBA approval");
    }

    return requestCibaApproval(request);
  }

  async function requestCapability(
    options: RequestCapabilityOptions
  ): Promise<CibaTokenSet> {
    const resource = options.resource ?? options.audience;
    const cacheKey = buildCapabilityCacheKey({
      action: options.action,
      audience: options.audience,
      authorizationDetails: options.authorizationDetails,
      clientId: config.clientId,
      resource,
      scope: options.scope,
    });
    const cached = capabilityTokensByKey.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const capabilityTokenSet = await requestApproval({ ...options, resource });
    if (reusableForCapability(capabilityTokenSet, options.action)) {
      capabilityTokensByKey.set(cacheKey, capabilityTokenSet);
    }

    return capabilityTokenSet;
  }

  function invalidateCapability(action: string, audience: string): void {
    const prefix = [config.clientId, audience, action, ""].join("\u0000");
    for (const key of capabilityTokensByKey.keys()) {
      if (key.startsWith(prefix)) {
        capabilityTokensByKey.delete(key);
      }
    }
  }

  async function proveHuman(options: ProveHumanOptions): Promise<string> {
    const approval = await requestCapability({
      action: PURCHASE_CAPABILITY,
      audience: options.audience,
      bindingMessage:
        options.bindingMessage ??
        truncateBindingMessage(
          `Authorize proof of human for ${options.audience}`
        ),
      scope: options.scope ?? POH_SCOPE,
      resource:
        options.resource ??
        config.resource ??
        resolveIssuerResource(config.issuerUrl),
      ...(options.authorizationDetails
        ? { authorizationDetails: options.authorizationDetails }
        : {}),
    });

    const proofOfHuman = await requestProofOfHumanToken({
      accessToken: approval.accessToken,
      dpopClient: config.dpopClient,
      fetch: fetchFn,
      proofOfHumanUrl: resolveProofOfHumanUrl(
        config.issuerUrl,
        config.proofOfHumanUrl
      ),
    });
    if (!proofOfHuman.ok) {
      throw new Error(
        proofOfHuman.errorDescription ??
          `Proof of human request failed: ${proofOfHuman.error}`
      );
    }

    const requiredLevel = options.minComplianceLevel;
    const actualLevel = identityStrengthTier(proofOfHuman.unverifiedClaims);
    if (typeof requiredLevel === "number" && actualLevel < requiredLevel) {
      throw new ComplianceInsufficientError({
        actualLevel,
        issuerUrl: config.issuerUrl,
        requiredLevel,
      });
    }

    return proofOfHuman.token;
  }

  const fetchWithX402 = createX402Fetch(fetchFn, {
    getPohToken: (minComplianceLevel, context) =>
      proveHuman({
        audience: resolveAudience(context.request.url),
        authorizationDetails: [
          {
            type: PURCHASE_CAPABILITY,
            minComplianceLevel,
            resource: context.paymentRequired.resource.url,
          },
        ],
        minComplianceLevel,
        resource: context.requirement.pohIssuer,
      }),
    onRetryForbidden: (context) => {
      invalidateCapability(
        PURCHASE_CAPABILITY,
        resolveAudience(context.request.url)
      );
    },
  });

  const agent: Agent = {
    fetch(input: RequestInfo | URL, init?: X402FetchOptions) {
      if (init?.x402?.autoPayWithProofOfHuman) {
        return fetchWithX402(input, init);
      }

      const { x402: _x402, ...requestInit } = init ?? {};
      return fetchFn(input, requestInit);
    },
    proveHuman,
    requestApproval,
    requestCapability,
  };

  return Object.freeze(agent);
}
