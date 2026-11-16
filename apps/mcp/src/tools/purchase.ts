import type {
  InputRequiredResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import {
  assertApprovedDetails,
  buildX402PurchaseAuthorization,
  type CreateX402FetchOptions,
  createX402Fetch,
  type X402ApprovalContext,
  X402PurchaseError,
  type X402PurchaseErrorCode,
} from "@zentity/sdk";
import {
  canonicalJson,
  IDENTITY_STRENGTHS,
  type IdentityStrength,
  truncateBindingMessage,
  type X402PaymentRequirements,
} from "@zentity/sdk/protocol";
import {
  createDpopClient,
  type DpopClient,
  PAYMENT_RESPONSE_HEADER,
  parsePaymentResponseHeader,
  requestProofOfHumanToken,
} from "@zentity/sdk/rp";
import { z } from "zod";
import { config } from "../config.js";
import { discoverMcpOAuth } from "../oauth-client.js";
import { signAgentAssertion } from "../runtime/agent-registration.js";
import {
  getAuthContext,
  getOAuthContext,
  tryGetRuntimeState,
  withToolAuth,
} from "../runtime/auth-context.js";
import { redeemRelease } from "../services/identity-release.js";
import {
  beginOrResumeInteractiveFlow,
  type InteractiveToolInteraction,
  requestUserAction,
} from "../services/interactive-approval.js";

const X402_REFUSALS = [
  "payment_not_configured",
  "merchant_mismatch",
  "untrusted_issuer",
  "unsupported_resource",
  "payment_bounds_exceeded",
  "identity_strength_bound_exceeded",
  "approval_mismatch",
] as const satisfies readonly X402PurchaseErrorCode[];

const purchaseOutputSchema = z.object({
  status: z.enum([
    "approved",
    "needs_user_action",
    "denied",
    "expired",
    ...X402_REFUSALS,
    "payment_failed",
  ]),
  approved: z.boolean().nullable(),
  bindingMessage: z.string(),
  error: z.string().optional(),
  fulfillment: z
    .object({
      name: z.string().nullable(),
      address: z.record(z.string(), z.unknown()).nullable(),
    })
    .nullable(),
  interaction: z
    .object({
      mode: z.literal("url"),
      url: z.string().url(),
      message: z.string(),
      expiresAt: z.string(),
    })
    .optional(),
  x402: z
    .object({
      identity_strength: z.string().nullable(),
      payment_response: z.unknown().nullable(),
      response: z.unknown().nullable(),
      status: z.number(),
    })
    .optional(),
});

type PurchaseStructuredContent = z.infer<typeof purchaseOutputSchema>;

function buildPurchaseResponse(structuredContent: PurchaseStructuredContent): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: PurchaseStructuredContent;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function formatFulfillment(
  pii: Awaited<ReturnType<typeof redeemRelease>>
): PurchaseStructuredContent["fulfillment"] {
  if (!pii) {
    return null;
  }

  const address =
    typeof pii.address === "string"
      ? { formatted: pii.address }
      : (pii.address ?? null);

  return {
    name: pii.name ?? null,
    address,
  };
}

interface PurchaseParams {
  amount?: number | undefined;
  currency?: string | undefined;
  item?: string | undefined;
  maxAmount?: number | undefined;
  maxIdentityStrength?: IdentityStrength | undefined;
  merchant?: string | undefined;
  requires_age_verification?: boolean | undefined;
  url?: string | undefined;
}

interface DirectPurchase {
  amount: number;
  currency: string;
  item: string;
  merchant: string;
  requiresAgeVerification: boolean;
}

export interface PurchaseToolOptions {
  /**
   * Signs x402 payments. The MCP server has no source of one yet, so x402
   * purchases answer `payment_not_configured`; tests inject a stub.
   */
  x402SchemeClient?: CreateX402FetchOptions["schemeClient"];
}

class PurchaseNeedsUserActionError extends Error {
  readonly interaction: InteractiveToolInteraction;

  constructor(interaction: InteractiveToolInteraction) {
    super("User action is required to complete the x402 purchase");
    this.name = "PurchaseNeedsUserActionError";
    this.interaction = interaction;
  }
}

class PurchaseAuthorizationEndedError extends Error {
  readonly status: "denied" | "expired";

  constructor(status: "denied" | "expired") {
    super(
      status === "denied"
        ? "User denied the x402 purchase authorization request"
        : "x402 purchase authorization expired"
    );
    this.name = "PurchaseAuthorizationEndedError";
    this.status = status;
  }
}

function buildPurchaseScope(requiresAgeVerification: boolean): string {
  return requiresAgeVerification
    ? "openid proof:age proof:nationality identity.name identity.address"
    : "openid identity.name identity.address";
}

const X402_PURCHASE_SCOPE = "openid poh";
const ISO_4217_CODE = /^[A-Z]{3}$/;

function sessionFingerprint(
  oauth: ReturnType<typeof getOAuthContext>,
  runtime: ReturnType<typeof tryGetRuntimeState>
): string[] {
  return [oauth.accountSub, oauth.clientId, runtime?.sessionId ?? "no-runtime"];
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readPaymentResponseHeader(response: Response): unknown {
  const header = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!header) {
    return null;
  }

  try {
    return parsePaymentResponseHeader(header);
  } catch {
    return null;
  }
}

interface PurchaseInput {
  ctx: ServerContext;
  oauth: ReturnType<typeof getOAuthContext>;
  runtime: ReturnType<typeof tryGetRuntimeState>;
  server: McpServer;
}

function needsUserActionResponse(
  input: PurchaseInput,
  bindingMessage: string,
  interaction: InteractiveToolInteraction
) {
  return requestUserAction(
    input.server,
    input.ctx,
    interaction,
    buildPurchaseResponse({
      status: "needs_user_action",
      approved: null,
      bindingMessage,
      fulfillment: null,
      interaction,
    })
  );
}

function x402BindingMessage(resourceUrl: string): string {
  return truncateBindingMessage(
    `Proof-of-Human for ${new URL(resourceUrl).host}`
  );
}

/**
 * Asks the user to approve a Proof-of-Human for the merchant's requirement
 * and mints the token under a key made for this purchase. A changed 402 is a
 * new requirement, so it starts a new approval.
 */
async function approveX402Purchase(
  input: PurchaseInput,
  requirement: X402PaymentRequirements,
  context: X402ApprovalContext
): Promise<{ dpopClient: DpopClient; pohToken: string }> {
  const bindingMessage = x402BindingMessage(context.resourceUrl);
  const authorizationDetails = [
    buildX402PurchaseAuthorization(requirement, context),
  ];
  const agentAssertion = input.runtime
    ? await signAgentAssertion(input.runtime, {
        bindingMessage,
        scope: X402_PURCHASE_SCOPE,
        authorizationDetails,
      })
    : undefined;

  const outcome = await beginOrResumeInteractiveFlow({
    toolName: "purchase",
    fingerprint: [
      ...sessionFingerprint(input.oauth, input.runtime),
      "x402",
      canonicalJson(authorizationDetails),
    ].join(":"),
    oauth: input.oauth,
    createFlowDpopClient: createDpopClient,
    approval: {
      scope: X402_PURCHASE_SCOPE,
      bindingMessage,
      authorizationDetails,
      ...(agentAssertion ? { agentAssertion } : {}),
    },
    onApproved: async (tokenSet, dpopClient) => {
      assertApprovedDetails(
        authorizationDetails,
        tokenSet.authorizationDetails
      );
      const proofOfHuman = await requestProofOfHumanToken({
        accessToken: tokenSet.accessToken,
        dpopClient,
        proofOfHumanUrl: `${config.zentityUrl}/api/auth/oauth2/proof-of-human`,
      });
      if (!proofOfHuman.ok) {
        throw new Error(
          proofOfHuman.errorDescription ??
            `Proof of human request failed: ${proofOfHuman.error}`
        );
      }
      return { dpopClient, pohToken: proofOfHuman.token };
    },
  });

  if (outcome.status === "needs_user_action") {
    throw new PurchaseNeedsUserActionError(outcome.interaction);
  }
  if (outcome.status !== "complete") {
    throw new PurchaseAuthorizationEndedError(outcome.status);
  }
  return outcome.data;
}

/**
 * The status of the merchant's final answer. Only a 2xx after the user's
 * approval is `approved`; a merchant that never asked for a Proof-of-Human
 * did not get one, and a refusal after approval is not a purchase.
 */
function merchantOutcome(
  response: Response,
  payload: unknown,
  approvedStrength: string | undefined
): Pick<PurchaseStructuredContent, "approved" | "error" | "status"> {
  if (approvedStrength === undefined) {
    return {
      status: "unsupported_resource",
      approved: false,
      error: `The merchant answered ${response.status} without asking for a Zentity Proof-of-Human`,
    };
  }
  if (response.ok) {
    return { status: "approved", approved: true };
  }
  const merchantError =
    payload && typeof payload === "object"
      ? (payload as { error?: unknown }).error
      : undefined;
  if (response.status === 403 && merchantError === "approval_mismatch") {
    return {
      status: "approval_mismatch",
      approved: false,
      error: "The merchant refused the approved terms",
    };
  }
  return {
    status: "payment_failed",
    approved: false,
    error: `The merchant refused the payment with ${response.status}`,
  };
}

async function runX402PurchaseTool(
  input: PurchaseInput,
  url: string,
  bounds: { maxAmount: number; maxIdentityStrength: IdentityStrength },
  options: PurchaseToolOptions
) {
  const bindingMessage = x402BindingMessage(url);
  let approvedStrength: string | undefined;
  try {
    const discovery = await discoverMcpOAuth();
    const x402Fetch = createX402Fetch({
      issuer: discovery.issuer,
      maxAmount: bounds.maxAmount,
      maxIdentityStrength: bounds.maxIdentityStrength,
      schemeClient: options.x402SchemeClient,
      approve: async (requirement, context) => {
        const approval = await approveX402Purchase(input, requirement, context);
        approvedStrength = context.minIdentityStrength;
        return approval;
      },
    });
    const response = await x402Fetch(url, { method: "GET" });
    const payload = await readResponsePayload(response);
    return buildPurchaseResponse({
      ...merchantOutcome(response, payload, approvedStrength),
      bindingMessage,
      fulfillment: null,
      x402: {
        identity_strength: approvedStrength ?? null,
        payment_response: readPaymentResponseHeader(response),
        response: payload,
        status: response.status,
      },
    });
  } catch (error) {
    if (error instanceof PurchaseNeedsUserActionError) {
      return needsUserActionResponse(input, bindingMessage, error.interaction);
    }
    if (error instanceof PurchaseAuthorizationEndedError) {
      return buildPurchaseResponse({
        status: error.status,
        approved: false,
        bindingMessage,
        fulfillment: null,
      });
    }
    if (error instanceof X402PurchaseError) {
      return buildPurchaseResponse({
        status: error.code,
        approved: false,
        bindingMessage,
        error: error.message,
        fulfillment: null,
      });
    }
    throw error;
  }
}

async function runDirectPurchaseTool(
  input: PurchaseInput,
  purchase: DirectPurchase
) {
  const bindingMessage = truncateBindingMessage(
    `Buy from ${purchase.merchant}`
  );
  const scope = buildPurchaseScope(purchase.requiresAgeVerification);
  const authorizationDetails = [
    {
      type: "purchase",
      merchant: { name: purchase.merchant },
      item: purchase.item,
      amount: {
        value: purchase.amount.toFixed(2),
        currency: purchase.currency,
      },
    },
  ];
  const agentAssertion = input.runtime
    ? await signAgentAssertion(input.runtime, {
        bindingMessage,
        scope,
        authorizationDetails,
      })
    : undefined;
  const outcome = await beginOrResumeInteractiveFlow({
    toolName: "purchase",
    fingerprint: [
      ...sessionFingerprint(input.oauth, input.runtime),
      "purchase",
      canonicalJson(authorizationDetails),
      scope,
    ].join(":"),
    oauth: input.oauth,
    approval: {
      scope,
      bindingMessage,
      authorizationDetails,
      ...(agentAssertion ? { agentAssertion } : {}),
    },
    onApproved: async (tokenSet) => {
      const pii = await redeemRelease(
        tokenSet.accessToken,
        input.oauth.dpopClient
      );
      return {
        status: "approved" as const,
        approved: true,
        bindingMessage,
        fulfillment: formatFulfillment(pii),
      };
    },
  });

  if (outcome.status === "needs_user_action") {
    return needsUserActionResponse(input, bindingMessage, outcome.interaction);
  }

  if (outcome.status === "complete") {
    return buildPurchaseResponse(outcome.data);
  }

  return buildPurchaseResponse({
    status: outcome.status,
    approved: false,
    bindingMessage,
    fulfillment: null,
  });
}

function invalidInput(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function runPurchaseTool(
  server: McpServer,
  ctx: ServerContext,
  params: PurchaseParams,
  options: PurchaseToolOptions
): Promise<
  | ReturnType<typeof buildPurchaseResponse>
  | InputRequiredResult
  | ReturnType<typeof invalidInput>
> {
  const auth = getAuthContext();
  const input: PurchaseInput = {
    ctx,
    oauth: getOAuthContext(auth),
    runtime: tryGetRuntimeState(auth),
    server,
  };

  if (params.url) {
    if (params.maxAmount === undefined) {
      return Promise.resolve(
        invalidInput("maxAmount is required for an x402 purchase")
      );
    }
    return runX402PurchaseTool(
      input,
      params.url,
      {
        maxAmount: params.maxAmount,
        maxIdentityStrength: params.maxIdentityStrength ?? "cryptographic_chip",
      },
      options
    );
  }

  const { amount, currency, item, merchant } = params;
  if (
    amount === undefined ||
    currency === undefined ||
    item === undefined ||
    merchant === undefined
  ) {
    return Promise.resolve(
      invalidInput(
        "amount, currency, item, and merchant are required without url"
      )
    );
  }
  return runDirectPurchaseTool(input, {
    amount,
    currency,
    item,
    merchant,
    requiresAgeVerification: Boolean(params.requires_age_verification),
  });
}

export function registerPurchaseTool(
  server: McpServer,
  options: PurchaseToolOptions = {}
): void {
  server.registerTool(
    "purchase",
    {
      title: "Purchase",
      description: [
        "Buy something on behalf of the user, who approves in the browser with a passkey.",
        "Without url: a purchase from a named merchant; pass merchant, item, amount, and currency, and the tool returns the user's shipping details once after approval.",
        "With url: an x402 resource that needs a Zentity Proof-of-Human. The user approves proving their identity to that merchant; the agent's own wallet pays the merchant's price, up to maxAmount. This needs a payment scheme client, so it answers payment_not_configured until one is configured.",
        "Statuses: approved, needs_user_action, denied, expired, payment_not_configured, merchant_mismatch, untrusted_issuer, unsupported_resource, payment_bounds_exceeded, identity_strength_bound_exceeded, approval_mismatch, payment_failed.",
        "An x402 purchase is approved only when the merchant accepts the payment after the user's approval; payment_failed means the user approved but the merchant refused the payment (see x402.status and x402.response), and unsupported_resource with an x402 field means the merchant answered without asking for a Proof-of-Human.",
      ].join(" "),
      inputSchema: z.object({
        merchant: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Merchant name (required without url)"),
        item: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Item being purchased (required without url)"),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("Purchase amount (required without url)"),
        currency: z
          .string()
          .regex(ISO_4217_CODE)
          .optional()
          .describe("ISO 4217 currency code, e.g. EUR (required without url)"),
        requires_age_verification: z
          .boolean()
          .optional()
          .describe(
            "Set true for age-restricted purchases (alcohol, tobacco). Adds proof:age and proof:nationality scopes."
          ),
        url: z
          .string()
          .url()
          .optional()
          .describe("x402 resource URL to fetch with a Proof-of-Human"),
        maxAmount: z
          .number()
          .positive()
          .optional()
          .describe(
            "The most to pay for the x402 resource, in USDC (required with url)"
          ),
        maxIdentityStrength: z
          .enum(IDENTITY_STRENGTHS)
          .optional()
          .describe(
            "The strongest identity verification the merchant may require (default cryptographic_chip)"
          ),
      }),
      outputSchema: purchaseOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    withToolAuth(server, (params, ctx) =>
      runPurchaseTool(server, ctx, params, options)
    )
  );
}
