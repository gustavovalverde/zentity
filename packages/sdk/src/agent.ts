import { decodeJwt } from "jose";
import {
  type CibaPendingApproval,
  type CibaRequest,
  type CibaTokenSet,
  requestCibaApproval,
} from "./ciba";
import { createDiscoveryResolver } from "./fpa/discovery";
import type { AccessTokenClaims, CapabilityClaim } from "./protocol/index";
import type { DpopClient } from "./rp/dpop-client";
import { requestProofOfHumanToken } from "./rp/proof-of-human";
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
}

export interface RequestApprovalOptions {
  agentAssertion?: string | undefined;
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
  decodeAccessToken(token: string): AccessTokenClaims & Record<string, unknown>;
  fetch: X402Fetch;
  proveHuman(options: ProveHumanOptions): Promise<string>;
  requestApproval(options: RequestApprovalOptions): Promise<CibaTokenSet>;
  requestCapability(options: RequestCapabilityOptions): Promise<CibaTokenSet>;
}

interface CachedCapabilityToken {
  accessToken: string;
  expiresAt: number;
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

export function decodeAccessToken(
  token: string
): AccessTokenClaims & Record<string, unknown> {
  return decodeJwt(token) as AccessTokenClaims & Record<string, unknown>;
}

function buildCapabilityCacheKey(input: {
  action: string;
  audience: string;
  clientId: string;
}): string {
  return [input.clientId, input.audience, input.action].join("\u0000");
}

function readCapabilityClaims(token: string): CapabilityClaim[] {
  const claims = decodeAccessToken(token);
  return Array.isArray(claims.capabilities)
    ? claims.capabilities.filter(
        (capability): capability is CapabilityClaim =>
          Boolean(capability) &&
          typeof capability === "object" &&
          typeof (capability as CapabilityClaim).action === "string"
      )
    : [];
}

function tokenHasCapability(token: string, action: string): boolean {
  return readCapabilityClaims(token).some(
    (capability) => capability.action === action
  );
}

function resolveTokenExpiresAt(
  token: string,
  fallbackExpiresAt: number
): number {
  const claims = decodeAccessToken(token);
  return typeof claims.exp === "number"
    ? Math.min(claims.exp * 1000, fallbackExpiresAt)
    : fallbackExpiresAt;
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
  const capabilityTokensByKey = new Map<string, CachedCapabilityToken>();

  async function requestApproval(
    options: RequestApprovalOptions
  ): Promise<CibaTokenSet> {
    const discovery = await discoveryResolver.read();
    if (!discovery.backchannel_authentication_endpoint) {
      throw new Error(
        "OpenID discovery response missing backchannel_authentication_endpoint"
      );
    }

    const request: CibaRequest = {
      bindingMessage: options.bindingMessage,
      cibaEndpoint: discovery.backchannel_authentication_endpoint,
      clientId: config.clientId,
      dpopSigner: config.dpopClient,
      fetch: fetchFn,
      loginHint: options.loginHint ?? config.loginHint ?? "",
      onPendingApproval: config.onPendingApproval,
      scope: options.scope,
      tokenEndpoint: discovery.token_endpoint,
      ...(options.agentAssertion
        ? { agentAssertion: options.agentAssertion }
        : {}),
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
    const cacheKey = buildCapabilityCacheKey({
      action: options.action,
      audience: options.audience,
      clientId: config.clientId,
    });
    const cached = capabilityTokensByKey.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        accessToken: cached.accessToken,
        expiresAt: cached.expiresAt,
      };
    }

    const capabilityTokenSet = await requestApproval({
      ...options,
      resource: options.resource ?? options.audience,
    });
    if (tokenHasCapability(capabilityTokenSet.accessToken, options.action)) {
      capabilityTokensByKey.set(cacheKey, {
        accessToken: capabilityTokenSet.accessToken,
        expiresAt: resolveTokenExpiresAt(
          capabilityTokenSet.accessToken,
          capabilityTokenSet.expiresAt
        ),
      });
    }

    return capabilityTokenSet;
  }

  function invalidateCapability(action: string, audience: string): void {
    capabilityTokensByKey.delete(
      buildCapabilityCacheKey({
        action,
        audience,
        clientId: config.clientId,
      })
    );
  }

  async function proveHuman(options: ProveHumanOptions): Promise<string> {
    const approval = await requestCapability({
      action: PURCHASE_CAPABILITY,
      audience: options.audience,
      bindingMessage:
        options.bindingMessage ??
        `Authorize proof of human for ${options.audience}`,
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
    if (
      typeof requiredLevel === "number" &&
      proofOfHuman.unverifiedClaims.tier < requiredLevel
    ) {
      throw new ComplianceInsufficientError({
        actualLevel: proofOfHuman.unverifiedClaims.tier,
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
    decodeAccessToken,
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
