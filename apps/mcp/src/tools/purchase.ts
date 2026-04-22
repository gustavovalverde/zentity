import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  status: z.enum(["complete", "needs_user_action", "denied", "expired"]),
  approved: z.boolean().nullable(),
  bindingMessage: z.string(),
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
      },
      outputSchema: purchaseOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({
      amount,
      currency,
      description,
      item,
      merchant,
      requires_age_verification,
    }) => {
      let auth: Awaited<ReturnType<typeof requireAuth>>;
      try {
        auth = await requireAuth();
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                error instanceof Error ? error.message : "Not authenticated",
            },
          ],
        };
      }

      const oauth = getOAuthContext(auth);
      const runtime = tryGetRuntimeState(auth);
      const params: PurchaseParams = {
        amount,
        currency,
        description,
        item,
        merchant,
        requires_age_verification,
      };
      const bindingMessage = prefixBindingMessage(
        runtime?.display.name ?? "Zentity MCP",
        buildRawBindingMessage(params)
      );
      const agentAssertion = runtime
        ? await signAgentAssertion(runtime, bindingMessage)
        : undefined;

      const outcome = await beginOrResumeInteractiveFlow({
        server,
        toolName: "purchase",
        fingerprint: buildPurchaseFingerprint(oauth, runtime, params),
        oauth,
        cibaRequest: {
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: oauth.clientId,
          dpopKey: oauth.dpopKey,
          loginHint: oauth.loginHint || oauth.accountSub,
          scope: buildPurchaseScope(Boolean(requires_age_verification)),
          bindingMessage,
          authorizationDetails: [
            {
              type: "purchase",
              merchant,
              item,
              amount: { value: amount.toFixed(2), currency },
            },
          ],
          resource: config.zentityUrl,
          ...(agentAssertion ? { agentAssertion } : {}),
        },
        onApproved: async (result) => {
          const pii = await redeemRelease(result.accessToken, oauth.dpopKey);
          return {
            status: "complete" as const,
            approved: true,
            bindingMessage,
            fulfillment: formatFulfillment(pii),
          };
        },
      });

      if (outcome.status === "needs_user_action") {
        throwUrlElicitationIfSupported(server, outcome);
        return buildPurchaseResponse({
          status: "needs_user_action",
          approved: null,
          bindingMessage,
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
        bindingMessage,
        fulfillment: null,
      });
    }
  );
}
