import type { SchemeNetworkClient } from "@x402/core/types";

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
import type {
  IdentityStrength,
  X402PaymentRequirements,
} from "./protocol/purchase-authorization";
import { createDpopClient, type DpopClient } from "./rp/dpop-client";
import { requestProofOfHumanToken } from "./rp/proof-of-human";
import {
  assertApprovedDetails,
  buildX402PurchaseAuthorization,
  createX402Fetch,
  type X402Approval,
  type X402ApprovalContext,
} from "./x402";

const X402_PURCHASE_SCOPE = "openid poh";

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
  /**
   * Signs x402 payments on Base Sepolia, for example
   * `new ExactEvmScheme(signer)` from `@x402/evm/exact/client`. Without it,
   * an x402 fetch fails with `payment_not_configured` before any approval.
   */
  x402SchemeClient?: SchemeNetworkClient | undefined;
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

/** The bounds an x402 purchase must stay within. */
export interface AgentX402Options {
  /** The most the agent pays, in display units of the registered asset. */
  maxAmount: string | number;
  /** The strongest identity the agent lets the merchant require. */
  maxIdentityStrength: IdentityStrength;
}

export interface AgentFetchInit extends RequestInit {
  /**
   * Pay an x402 `402 Payment Required` with the user's Proof-of-Human
   * approval, within these bounds. Without it, a 402 is returned as is.
   */
  x402?: AgentX402Options | undefined;
}

export interface Agent {
  /**
   * Fetches a resource. With `init.x402`, an x402 merchant's 402 is answered
   * with one user-approved Proof-of-Human and a payment signed by
   * `x402SchemeClient`; failures throw `X402PurchaseError`.
   */
  fetch(input: RequestInfo | URL, init?: AgentFetchInit): Promise<Response>;
  requestApproval(options: RequestApprovalOptions): Promise<CibaTokenSet>;
  requestCapability(options: RequestCapabilityOptions): Promise<CibaTokenSet>;
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

export function createAgent(config: AgentConfig): Agent {
  const fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  const discoveryResolver = createDiscoveryResolver({
    fetch: fetchFn,
    issuerUrl: config.issuerUrl,
  });
  const capabilityTokensByKey = new Map<string, CibaTokenSet>();

  async function sendApproval(
    options: RequestApprovalOptions,
    dpopClient: DpopClient,
    resource: string | undefined
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
      dpopClient,
      fetch: fetchFn,
      loginHint: options.loginHint ?? config.loginHint ?? "",
      onPendingApproval: config.onPendingApproval,
      scope: options.scope,
      tokenEndpoint: discovery.token_endpoint,
      ...(agentAssertion ? { agentAssertion } : {}),
      ...(options.authorizationDetails
        ? { authorizationDetails: options.authorizationDetails }
        : {}),
      ...(resource ? { resource } : {}),
    };

    if (!request.loginHint) {
      throw new Error("Agent loginHint is required for CIBA approval");
    }

    return requestCibaApproval(request);
  }

  function requestApproval(
    options: RequestApprovalOptions
  ): Promise<CibaTokenSet> {
    return sendApproval(
      options,
      config.dpopClient,
      options.resource ?? config.resource
    );
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

  /**
   * One user approval per x402 purchase, under a key generated for it: the
   * CIBA request, the token poll, the PoH mint, and the merchant request all
   * use it, and the installation key never reaches the merchant.
   */
  async function approveX402Purchase(
    requirement: X402PaymentRequirements,
    context: X402ApprovalContext
  ): Promise<X402Approval> {
    const dpopClient = await createDpopClient();
    const authorizationDetails = [
      buildX402PurchaseAuthorization(requirement, context),
    ];
    const tokenSet = await sendApproval(
      {
        bindingMessage: truncateBindingMessage(
          `Proof-of-Human for ${new URL(context.resourceUrl).host}`
        ),
        scope: X402_PURCHASE_SCOPE,
        authorizationDetails,
      },
      dpopClient,
      undefined
    );
    assertApprovedDetails(authorizationDetails, tokenSet.authorizationDetails);

    const proofOfHuman = await requestProofOfHumanToken({
      accessToken: tokenSet.accessToken,
      dpopClient,
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
    return { pohToken: proofOfHuman.token, dpopClient };
  }

  const agent: Agent = {
    async fetch(input: RequestInfo | URL, init?: AgentFetchInit) {
      const { x402, ...requestInit } = init ?? {};
      if (!x402) {
        return fetchFn(input, requestInit);
      }
      const discovery = await discoveryResolver.read();
      return createX402Fetch({
        fetch: fetchFn,
        issuer: discovery.issuer,
        maxAmount: x402.maxAmount,
        maxIdentityStrength: x402.maxIdentityStrength,
        schemeClient: config.x402SchemeClient,
        approve: approveX402Purchase,
      })(input, requestInit);
    },
    requestApproval,
    requestCapability,
  };

  return Object.freeze(agent);
}
