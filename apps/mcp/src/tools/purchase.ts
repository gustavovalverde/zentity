import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ComplianceInsufficientError,
  createX402Fetch,
  type X402PaymentContext,
} from "@zentity/sdk";
import {
  createDpopClientFromKeyPair,
  type ProofOfHumanClaims,
  requestProofOfHumanToken,
} from "@zentity/sdk/rp";
import { z } from "zod";
import { prefixBindingMessage } from "../agent.js";
import { signAgentAssertion } from "../auth/agent-registration.js";
import {
  getOAuthContext,
  requireAuth,
  tryGetRuntimeState,
} from "../auth/context.js";
import { redeemRelease } from "../auth/identity.js";
import {
  beginOrResumeInteractiveFlow,
  throwUrlElicitationIfSupported,
} from "../auth/interactive-tool-flow.js";
import { config } from "../config.js";

const purchaseOutputSchema = {
  status: z.enum([
    "complete",
    "needs_user_action",
    "denied",
    "expired",
    "compliance_insufficient",
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
  upgrade_url: z.string().url().optional(),
  x402: z
    .object({
      level_used: z.number().nullable(),
      poh_issuer: z.string().nullable(),
      response: z.unknown().nullable(),
      retried: z.boolean(),
      status: z.number(),
    })
    .optional(),
};

type PurchaseStructuredContent = z.infer<
  z.ZodObject<typeof purchaseOutputSchema>
>;

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
  amount: number;
  currency: string;
  description?: string | undefined;
  item: string;
  merchant: string;
  requires_age_verification?: boolean | undefined;
  url?: string | undefined;
}

class PurchaseNeedsUserActionError extends Error {
  readonly interaction: Extract<
    Awaited<ReturnType<typeof beginOrResumeInteractiveFlow>>,
    { status: "needs_user_action" }
  >["interaction"];

  constructor(
    interaction: Extract<
      Awaited<ReturnType<typeof beginOrResumeInteractiveFlow>>,
      { status: "needs_user_action" }
    >["interaction"]
  ) {
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

function buildRawBindingMessage(params: PurchaseParams): string {
  const { item, merchant, amount, currency, description } = params;
  const base = `Purchase ${item} from ${merchant} for ${amount} ${currency}`;
  return description ? `${base}: ${description}` : base;
}

function buildPurchaseFingerprint(
  oauth: ReturnType<typeof getOAuthContext>,
  runtime: ReturnType<typeof tryGetRuntimeState>,
  params: PurchaseParams
): string {
  return [
    oauth.accountSub || oauth.loginHint,
    oauth.clientId,
    runtime?.sessionId ?? "no-runtime",
    "purchase",
    params.merchant,
    params.item,
    params.amount.toFixed(2),
    params.currency,
    params.description?.trim() ?? "",
    params.requires_age_verification ? "age" : "standard",
  ].join(":");
}

function buildPurchaseScope(requiresAgeVerification: boolean): string {
  return requiresAgeVerification
    ? "openid proof:age proof:nationality identity.name identity.address"
    : "openid identity.name identity.address";
}

function buildX402PurchaseScope(): string {
  return "openid poh";
}

function buildX402PurchaseFingerprint(
  oauth: ReturnType<typeof getOAuthContext>,
  runtime: ReturnType<typeof tryGetRuntimeState>,
  params: PurchaseParams
): string {
  return [
    oauth.accountSub || oauth.loginHint,
    oauth.clientId,
    runtime?.sessionId ?? "no-runtime",
    "x402",
    params.url,
    params.amount.toFixed(2),
    params.currency,
    params.description?.trim() ?? "",
  ].join(":");
}

function buildX402BindingMessage(params: PurchaseParams): string {
  const target = params.url ? new URL(params.url).origin : params.merchant;
  const base = `Authorize x402 purchase from ${target} for ${params.amount} ${params.currency}`;
  return params.description ? `${base}: ${params.description}` : base;
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

async function requestProofOfHumanForPurchase(input: {
  accessToken: string;
  dpopKey: ReturnType<typeof getOAuthContext>["dpopKey"];
  minComplianceLevel: number;
}): Promise<{ claims: ProofOfHumanClaims; token: string }> {
  const dpopClient = await createDpopClientFromKeyPair(input.dpopKey);
  const proofOfHuman = await requestProofOfHumanToken({
    accessToken: input.accessToken,
    dpopClient,
    proofOfHumanUrl: `${config.zentityUrl}/api/auth/oauth2/proof-of-human`,
  });

  if (!proofOfHuman.ok) {
    throw new Error(
      proofOfHuman.errorDescription ??
        `Proof of human request failed: ${proofOfHuman.error}`
    );
  }

  if (proofOfHuman.unverifiedClaims.tier < input.minComplianceLevel) {
    throw new ComplianceInsufficientError({
      actualLevel: proofOfHuman.unverifiedClaims.tier,
      issuerUrl: config.zentityUrl,
      requiredLevel: input.minComplianceLevel,
    });
  }

  return {
    claims: proofOfHuman.unverifiedClaims,
    token: proofOfHuman.token,
  };
}

async function fetchX402Purchase(input: {
  agentAssertion?: string | undefined;
  bindingMessage: string;
  oauth: ReturnType<typeof getOAuthContext>;
  params: PurchaseParams;
  runtime: ReturnType<typeof tryGetRuntimeState>;
  server: McpServer;
}): Promise<PurchaseStructuredContent> {
  let proofOfHumanClaims: ProofOfHumanClaims | undefined;
  let x402Context: X402PaymentContext | undefined;

  const fetchWithX402 = createX402Fetch(fetch, {
    getPohToken: async (minComplianceLevel, context) => {
      x402Context = context;
      const outcome = await beginOrResumeInteractiveFlow({
        server: input.server,
        toolName: "purchase",
        fingerprint: buildX402PurchaseFingerprint(
          input.oauth,
          input.runtime,
          input.params
        ),
        oauth: input.oauth,
        cibaRequest: {
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: input.oauth.clientId,
          dpopKey: input.oauth.dpopKey,
          loginHint: input.oauth.loginHint || input.oauth.accountSub,
          scope: buildX402PurchaseScope(),
          bindingMessage: input.bindingMessage,
          authorizationDetails: [
            {
              type: "purchase",
              url: input.params.url,
              amount: {
                value: input.params.amount.toFixed(2),
                currency: input.params.currency,
              },
              minComplianceLevel,
            },
          ],
          resource: config.zentityUrl,
          ...(input.agentAssertion
            ? { agentAssertion: input.agentAssertion }
            : {}),
        },
        onApproved: async (tokenSet) => {
          const proofOfHuman = await requestProofOfHumanForPurchase({
            accessToken: tokenSet.accessToken,
            dpopKey: input.oauth.dpopKey,
            minComplianceLevel,
          });
          proofOfHumanClaims = proofOfHuman.claims;
          return proofOfHuman.token;
        },
      });

      if (outcome.status === "needs_user_action") {
        throw new PurchaseNeedsUserActionError(outcome.interaction);
      }
      if (outcome.status === "denied") {
        throw new PurchaseAuthorizationEndedError("denied");
      }
      if (outcome.status === "expired") {
        throw new PurchaseAuthorizationEndedError("expired");
      }

      if (outcome.status === "complete") {
        return outcome.data;
      }

      throw new Error("Unexpected x402 purchase authorization state");
    },
  });

  const response = await fetchWithX402(input.params.url ?? "", {
    method: "GET",
    x402: { autoPayWithProofOfHuman: true },
  });
  const responsePayload = await readResponsePayload(response);

  return {
    status: "complete",
    approved: response.ok,
    bindingMessage: input.bindingMessage,
    fulfillment: null,
    x402: {
      level_used:
        proofOfHumanClaims?.tier ??
        x402Context?.requirement.minComplianceLevel ??
        null,
      poh_issuer: x402Context?.requirement.pohIssuer ?? null,
      response: responsePayload,
      retried: Boolean(x402Context),
      status: response.status,
    },
  };
}

async function runX402PurchaseTool(input: {
  agentAssertion?: string | undefined;
  bindingMessage: string;
  oauth: ReturnType<typeof getOAuthContext>;
  params: PurchaseParams;
  runtime: ReturnType<typeof tryGetRuntimeState>;
  server: McpServer;
}) {
  try {
    return buildPurchaseResponse(await fetchX402Purchase(input));
  } catch (error) {
    if (error instanceof PurchaseNeedsUserActionError) {
      const outcome = {
        status: "needs_user_action" as const,
        interaction: error.interaction,
      };
      throwUrlElicitationIfSupported(input.server, outcome);
      return buildPurchaseResponse({
        status: "needs_user_action",
        approved: null,
        bindingMessage: input.bindingMessage,
        fulfillment: null,
        interaction: error.interaction,
      });
    }
    if (error instanceof ComplianceInsufficientError) {
      return buildPurchaseResponse({
        status: "compliance_insufficient",
        approved: false,
        bindingMessage: input.bindingMessage,
        error: error.message,
        fulfillment: null,
        upgrade_url: error.upgradeUrl,
      });
    }
    if (error instanceof PurchaseAuthorizationEndedError) {
      return buildPurchaseResponse({
        status: error.status,
        approved: false,
        bindingMessage: input.bindingMessage,
        fulfillment: null,
      });
    }
    throw error;
  }
}

async function runLegacyPurchaseTool(input: {
  agentAssertion?: string | undefined;
  bindingMessage: string;
  oauth: ReturnType<typeof getOAuthContext>;
  params: PurchaseParams;
  runtime: ReturnType<typeof tryGetRuntimeState>;
  server: McpServer;
}) {
  const outcome = await beginOrResumeInteractiveFlow({
    server: input.server,
    toolName: "purchase",
    fingerprint: buildPurchaseFingerprint(
      input.oauth,
      input.runtime,
      input.params
    ),
    oauth: input.oauth,
    cibaRequest: {
      cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
      tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
      clientId: input.oauth.clientId,
      dpopKey: input.oauth.dpopKey,
      loginHint: input.oauth.loginHint || input.oauth.accountSub,
      scope: buildPurchaseScope(
        Boolean(input.params.requires_age_verification)
      ),
      bindingMessage: input.bindingMessage,
      authorizationDetails: [
        {
          type: "purchase",
          merchant: input.params.merchant,
          item: input.params.item,
          amount: {
            value: input.params.amount.toFixed(2),
            currency: input.params.currency,
          },
        },
      ],
      resource: config.zentityUrl,
      ...(input.agentAssertion ? { agentAssertion: input.agentAssertion } : {}),
    },
    onApproved: async (tokenSet) => {
      const pii = await redeemRelease(
        tokenSet.accessToken,
        input.oauth.dpopKey
      );
      return {
        status: "complete" as const,
        approved: true,
        bindingMessage: input.bindingMessage,
        fulfillment: formatFulfillment(pii),
      };
    },
  });

  if (outcome.status === "needs_user_action") {
    throwUrlElicitationIfSupported(input.server, outcome);
    return buildPurchaseResponse({
      status: "needs_user_action",
      approved: null,
      bindingMessage: input.bindingMessage,
      fulfillment: null,
      interaction: outcome.interaction,
    });
  }

  if (outcome.status === "complete") {
    return buildPurchaseResponse(outcome.data);
  }

  return buildPurchaseResponse({
    status: outcome.status,
    approved: false,
    bindingMessage: input.bindingMessage,
    fulfillment: null,
  });
}

async function runPurchaseTool(server: McpServer, params: PurchaseParams) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth();
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: error instanceof Error ? error.message : "Not authenticated",
        },
      ],
    };
  }

  const oauth = getOAuthContext(auth);
  const runtime = tryGetRuntimeState(auth);
  const rawBindingMessage = params.url
    ? buildX402BindingMessage(params)
    : buildRawBindingMessage(params);
  const bindingMessage = prefixBindingMessage(
    runtime?.display.name ?? "Zentity MCP",
    rawBindingMessage
  );
  const agentAssertion = runtime
    ? await signAgentAssertion(runtime, bindingMessage)
    : undefined;

  const purchaseInput = {
    agentAssertion,
    bindingMessage,
    oauth,
    params,
    runtime,
    server,
  };

  return params.url
    ? runX402PurchaseTool(purchaseInput)
    : runLegacyPurchaseTool(purchaseInput);
}

export function registerPurchaseTool(server: McpServer): void {
  server.registerTool(
    "purchase",
    {
      title: "Purchase",
      description:
        "Authorize and execute a purchase on behalf of the user. This tool owns the browser approval flow and returns fulfillment data after approval.",
      inputSchema: {
        amount: z.number().describe("Purchase amount"),
        currency: z.string().describe("Currency code (e.g. USD, EUR)"),
        description: z
          .string()
          .optional()
          .describe("Additional purchase context"),
        item: z.string().describe("Item being purchased"),
        merchant: z.string().describe("Merchant name"),
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
          .describe("Optional x402 merchant URL to fetch with PoH retry"),
      },
      outputSchema: purchaseOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    ({
      amount,
      currency,
      description,
      item,
      merchant,
      requires_age_verification,
      url,
    }) => {
      return runPurchaseTool(server, {
        amount,
        currency,
        description,
        item,
        merchant,
        requires_age_verification,
        url,
      });
    }
  );
}
