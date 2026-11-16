import { x402Client } from "@x402/core/client";
import type { SchemeNetworkClient } from "@x402/core/types";

import { findRegisteredAsset, toAtomic } from "./protocol/asset-registry";
import { canonicalJson } from "./protocol/authorization-details";
import {
  type IdentityStrength,
  meetsIdentityStrength,
  X402_PURCHASE_TYPE,
  type X402PaymentRequirements,
  X402PaymentRequirementsSchema,
  type X402PurchaseAuthorization,
  X402PurchaseAuthorizationSchema,
} from "./protocol/purchase-authorization";
import type { DpopClient } from "./rp/dpop-client";
import {
  encodePaymentSignatureHeader,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentRequiredPayload,
  type PaymentSignaturePayload,
  parsePaymentRequiredHeader,
  readOAuthAuthHints,
  readZentityExtension,
} from "./rp/payment-required";

/**
 * Why an x402 purchase stopped before or after the user's approval. Every
 * code before `approval_mismatch` is decided before Zentity is contacted.
 */
export type X402PurchaseErrorCode =
  /** No scheme client can sign a payment. */
  | "payment_not_configured"
  /** The 402 names a resource on another origin than the request. */
  | "merchant_mismatch"
  /** The 402 names another authorization server than the configured issuer. */
  | "untrusted_issuer"
  /** The 402 has no usable Zentity requirement, or needs an on-chain check. */
  | "unsupported_resource"
  /** Every payable requirement costs more than `maxAmount`. */
  | "payment_bounds_exceeded"
  /** The merchant needs a stronger identity than `maxIdentityStrength`. */
  | "identity_strength_bound_exceeded"
  /** Zentity approved other details than the agent requested. */
  | "approval_mismatch";

export class X402PurchaseError extends Error {
  readonly code: X402PurchaseErrorCode;

  constructor(code: X402PurchaseErrorCode, message: string) {
    super(message);
    this.name = "X402PurchaseError";
    this.code = code;
  }
}

/** What the agent asks the user to approve for one x402 resource. */
export interface X402ApprovalContext {
  /** The OAuth issuer the 402's `auth-hints` names, equal to `issuer`. */
  authorizationServer: string;
  minIdentityStrength: IdentityStrength;
  paymentRequired: PaymentRequiredPayload;
  request: Request;
  /** The merchant's description, when it is plain text Zentity can show. */
  resourceDescription?: string | undefined;
  /** The absolute resource URL from the 402. */
  resourceUrl: string;
}

/** The result of an approved x402 purchase: a PoH token and the key it is bound to. */
export interface X402Approval {
  /** The per-purchase DPoP client the token is bound to. */
  dpopClient: Pick<DpopClient, "fetch">;
  pohToken: string;
}

export interface CreateX402FetchOptions {
  /**
   * Asks the user to approve the selected requirement and returns a
   * merchant-mode PoH token with the per-purchase DPoP client it is bound to.
   * The payment is signed only after it resolves.
   */
  approve(
    requirement: X402PaymentRequirements,
    context: X402ApprovalContext
  ): Promise<X402Approval>;
  fetch?: typeof globalThis.fetch;
  /** The Zentity OAuth issuer the merchant must name in `auth-hints`. */
  issuer: string | URL;
  /** The most the agent pays, in display units of the registered asset. */
  maxAmount: string | number;
  /** The strongest identity the agent lets a merchant require. */
  maxIdentityStrength: IdentityStrength;
  /**
   * Signs the payment for Base Sepolia, for example
   * `new ExactEvmScheme(signer)` from `@x402/evm/exact/client`. Without one,
   * every 402 ends with `payment_not_configured` before any approval.
   */
  schemeClient?: SchemeNetworkClient | undefined;
}

export type X402Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const TRAILING_SLASHES = /\/+$/;
const NON_PLAIN_TEXT = /[\p{Cc}\p{Cf}]/u;
const MAX_DESCRIPTION_LENGTH = 256;

/**
 * `maxAmount` in the asset's atomic units, rounded down when it has more
 * fraction digits than the asset, so the bound never grows.
 */
function maxAtomicAmount(
  maxAmount: string | number,
  asset: { decimals: number }
): string {
  const text =
    typeof maxAmount === "number" && /e/i.test(String(maxAmount))
      ? maxAmount.toFixed(20)
      : String(maxAmount);
  const [whole, fraction = ""] = text.split(".");
  const kept = fraction.slice(0, asset.decimals);
  try {
    return toAtomic(kept ? `${whole}.${kept}` : (whole ?? text), asset);
  } catch {
    // Exponent forms and malformed bounds fall back to the exact conversion,
    // which refuses what it cannot represent.
    return toAtomic(maxAmount, asset);
  }
}

function normalizeIssuer(issuer: string | URL): string {
  return String(issuer).replace(TRAILING_SLASHES, "");
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function readPaymentRequired(
  headerValue: string | null
): PaymentRequiredPayload | null {
  if (!headerValue) {
    return null;
  }
  try {
    return parsePaymentRequiredHeader(headerValue);
  } catch {
    return null;
  }
}

function plainDescription(description: string | undefined): string | undefined {
  return description &&
    description.length <= MAX_DESCRIPTION_LENGTH &&
    !NON_PLAIN_TEXT.test(description)
    ? description
    : undefined;
}

interface SelectedRequirement {
  /** The merchant's requirement object, as the payment payload echoes it. */
  advertised: PaymentRequiredPayload["accepts"][number];
  parsed: X402PaymentRequirements;
}

/**
 * The checks before asking the user, in order: a scheme client exists, the
 * resource is on the request's origin, the merchant trusts this issuer, the
 * resource needs no on-chain check, a registered requirement fits
 * `maxAmount`, and its identity minimum fits `maxIdentityStrength`.
 */
function preApprovalChecks(
  options: CreateX402FetchOptions,
  request: Request,
  paymentRequired: PaymentRequiredPayload
): { context: X402ApprovalContext; selected: SelectedRequirement } {
  if (!options.schemeClient) {
    throw new X402PurchaseError(
      "payment_not_configured",
      "No payment scheme client is configured for x402 purchases"
    );
  }

  const resourceUrl = paymentRequired.resource.url;
  if (originOf(resourceUrl) !== new URL(request.url).origin) {
    throw new X402PurchaseError(
      "merchant_mismatch",
      "The 402 names a resource on another origin than the request"
    );
  }

  const hints = readOAuthAuthHints(paymentRequired);
  if (!hints) {
    throw new X402PurchaseError(
      "unsupported_resource",
      "The 402 does not say how to authenticate for payment"
    );
  }
  const issuer = normalizeIssuer(options.issuer);
  const trusted = hints.filter(
    (hint) =>
      hint.tokenType === "DPoP" &&
      normalizeIssuer(hint.authorizationServer) === issuer
  );
  if (trusted.length === 0) {
    throw new X402PurchaseError(
      "untrusted_issuer",
      "The 402 asks for another authorization server than Zentity"
    );
  }

  const zentity = readZentityExtension(paymentRequired);
  if (!zentity) {
    throw new X402PurchaseError(
      "unsupported_resource",
      "The 402 has no Zentity identity requirement"
    );
  }
  if (zentity.identityRegistryMirror) {
    throw new X402PurchaseError(
      "unsupported_resource",
      "Resources that check identity on-chain are not available to agents"
    );
  }

  const covered = new Set(trusted.flatMap((hint) => hint.acceptIndexes));
  const payable = paymentRequired.accepts.flatMap((advertised, index) => {
    if (!covered.has(index)) {
      return [];
    }
    const parsed = X402PaymentRequirementsSchema.safeParse(advertised);
    if (!parsed.success) {
      return [];
    }
    const asset = findRegisteredAsset(parsed.data.network, parsed.data.asset);
    return asset ? [{ advertised, parsed: parsed.data, asset }] : [];
  });
  if (payable.length === 0) {
    throw new X402PurchaseError(
      "unsupported_resource",
      "The 402 offers no requirement in a registered asset"
    );
  }
  const affordable = payable.find(
    ({ parsed, asset }) =>
      BigInt(parsed.amount) <= BigInt(maxAtomicAmount(options.maxAmount, asset))
  );
  if (!affordable) {
    throw new X402PurchaseError(
      "payment_bounds_exceeded",
      `The resource costs more than ${options.maxAmount}`
    );
  }

  if (
    !meetsIdentityStrength(
      options.maxIdentityStrength,
      zentity.minIdentityStrength
    )
  ) {
    throw new X402PurchaseError(
      "identity_strength_bound_exceeded",
      `The merchant requires ${zentity.minIdentityStrength} identity, above ${options.maxIdentityStrength}`
    );
  }

  return {
    selected: { advertised: affordable.advertised, parsed: affordable.parsed },
    context: {
      authorizationServer: issuer,
      minIdentityStrength: zentity.minIdentityStrength,
      paymentRequired,
      request,
      resourceDescription: plainDescription(
        paymentRequired.resource.description
      ),
      resourceUrl,
    },
  };
}

/**
 * The x402 client that signs only the approved requirement: the scheme
 * client on Base Sepolia, registered assets only, and a per-payment cap of
 * `maxAmount`, which replaces `@x402/core`'s default `$1` cap for the asset.
 */
function createPaymentClient(
  options: CreateX402FetchOptions,
  requirement: X402PaymentRequirements
): x402Client {
  const asset = findRegisteredAsset(requirement.network, requirement.asset);
  if (!(asset && options.schemeClient)) {
    throw new X402PurchaseError(
      "payment_not_configured",
      "No payment scheme client is configured for x402 purchases"
    );
  }
  return new x402Client()
    .register(asset.network as `${string}:${string}`, options.schemeClient)
    .registerPolicy((_version, requirements) =>
      requirements.filter((entry) =>
        findRegisteredAsset(entry.network, entry.asset)
      )
    )
    .setSpendControls({
      allowedAssets: [
        {
          network: asset.network as `${string}:${string}`,
          asset: asset.asset,
          maxAmountPerPayment: maxAtomicAmount(options.maxAmount, asset),
        },
      ],
    });
}

// Bytes, not text: a binary body would not survive a UTF-8 round trip.
async function replayableBody(
  request: Request
): Promise<ArrayBuffer | undefined> {
  return request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.clone().arrayBuffer();
}

/**
 * An `x402_purchase` entry for the selected requirement, copied verbatim, as
 * the agent sends it to bc-authorize.
 */
export function buildX402PurchaseAuthorization(
  requirement: X402PaymentRequirements,
  context: Pick<
    X402ApprovalContext,
    "minIdentityStrength" | "resourceDescription" | "resourceUrl"
  >
): X402PurchaseAuthorization {
  return X402PurchaseAuthorizationSchema.parse({
    type: X402_PURCHASE_TYPE,
    resource_url: context.resourceUrl,
    ...(context.resourceDescription
      ? { resource_description: context.resourceDescription }
      : {}),
    payment_requirements: requirement,
    min_identity_strength: context.minIdentityStrength,
  });
}

/**
 * Throws `approval_mismatch` unless the token response returned exactly the
 * `authorization_details` the agent sent.
 */
export function assertApprovedDetails(
  sent: readonly unknown[],
  approved: readonly unknown[] | undefined
): void {
  let matches = false;
  try {
    matches = canonicalJson(sent) === canonicalJson(approved ?? []);
  } catch {
    matches = false;
  }
  if (!matches) {
    throw new X402PurchaseError(
      "approval_mismatch",
      "Zentity approved other terms than the agent requested"
    );
  }
}

/**
 * A `fetch` that answers an x402 `402 Payment Required` from a merchant that
 * accepts Zentity Proof-of-Human: it checks the 402, asks the user through
 * `approve`, signs the approved requirement, and retries with
 * `PAYMENT-SIGNATURE` and the PoH token presented as
 * `Authorization: DPoP <token>` with a proof from the approval's key. Any
 * other response is returned as is. Failures before the retry throw
 * {@link X402PurchaseError}; aborting the request's signal before the
 * payment is signed rejects with the signal's reason and pays nothing.
 */
export function createX402Fetch(options: CreateX402FetchOptions): X402Fetch {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);

  return async (input, init) => {
    const request = new Request(input, init);
    const response = await fetchFn(request.clone());
    if (response.status !== 402) {
      return response;
    }
    const paymentRequired = readPaymentRequired(
      response.headers.get(PAYMENT_REQUIRED_HEADER)
    );
    if (!paymentRequired) {
      return response;
    }

    const { selected, context } = preApprovalChecks(
      options,
      request,
      paymentRequired
    );
    const approval = await options.approve(selected.parsed, context);
    // Approval can take minutes; a caller that gave up must not pay.
    request.signal.throwIfAborted();

    const paymentPayload = (await createPaymentClient(
      options,
      selected.parsed
    ).createPaymentPayload({
      ...paymentRequired,
      accepts: [selected.advertised],
    })) as PaymentSignaturePayload;

    const headers = new Headers(request.headers);
    headers.set(
      PAYMENT_SIGNATURE_HEADER,
      encodePaymentSignatureHeader(paymentPayload)
    );
    const body = await replayableBody(request);
    return approval.dpopClient.fetch(request.url, {
      method: request.method,
      headers,
      signal: request.signal,
      ...(body === undefined ? {} : { body }),
      accessToken: approval.pohToken,
      fetch: fetchFn,
    });
  };
}
