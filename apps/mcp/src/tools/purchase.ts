import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prefixBindingMessage } from "../agent.js";
import { signAgentAssertion } from "../auth/agent-registration.js";
import {
  beginOrResumeInteractiveFlow,
  throwUrlElicitationIfSupported,
} from "../auth/interactive-tool-flow.js";
import { getOAuthContext, requireAuth, tryGetRuntimeState } from "../auth/context.js";
import { redeemRelease } from "../auth/identity.js";
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

type PurchaseStructuredContent = z.infer<z.ZodObject<typeof purchaseOutputSchema>>;

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
      try {
        await requireAuth();
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

      const auth = await requireAuth();
      const oauth = getOAuthContext(auth);
      const runtime = tryGetRuntimeState(auth);
      const authorizationDetails = [
        {
          type: "purchase",
          merchant,
          item,
          amount: { value: amount.toFixed(2), currency },
        },
      ];
      const rawMessage = description
        ? `Purchase ${item} from ${merchant} for ${amount} ${currency}: ${description}`
        : `Purchase ${item} from ${merchant} for ${amount} ${currency}`;
      const bindingMessage = prefixBindingMessage(
        runtime?.display.name ?? "Zentity MCP",
        rawMessage
      );
      const agentAssertion = runtime
        ? await signAgentAssertion(runtime, bindingMessage)
        : undefined;

      const outcome = await beginOrResumeInteractiveFlow({
        server,
        toolName: "purchase",
        fingerprint: [
          oauth.accountSub || oauth.loginHint,
          oauth.clientId,
          runtime?.sessionId ?? "no-runtime",
          "purchase",
          merchant,
          item,
          amount.toFixed(2),
          currency,
          description?.trim() ?? "",
          requires_age_verification ? "age" : "standard",
        ].join(":"),
        oauth,
        cibaRequest: {
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: oauth.clientId,
          dpopKey: oauth.dpopKey,
          loginHint: oauth.loginHint || oauth.accountSub,
          scope: requires_age_verification
            ? "openid proof:age proof:nationality identity.name identity.address"
            : "openid identity.name identity.address",
          bindingMessage,
          authorizationDetails,
          resource: config.zentityUrl,
          ...(agentAssertion ? { agentAssertion } : {}),
        },
        onApproved: async (result) => {
          const pii = await redeemRelease(result.accessToken, oauth.dpopKey);
          return {
            status: "complete" as const,
            approved: true,
            bindingMessage,
            fulfillment: pii
              ? {
                  name: pii.name ?? null,
                  address:
                    typeof pii.address === "string"
                      ? { formatted: pii.address }
                      : (pii.address ?? null),
                }
              : null,
          };
        },
      });

      if (outcome.status === "needs_user_action") {
        throwUrlElicitationIfSupported(server, outcome);
        const structuredContent: PurchaseStructuredContent = {
          status: "needs_user_action",
          approved: null,
          bindingMessage,
          fulfillment: null,
          interaction: outcome.interaction,
        };
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

      const structuredContent: PurchaseStructuredContent =
        outcome.status === "complete"
          ? outcome.data
          : {
              status: outcome.status,
              approved: false,
              bindingMessage,
              fulfillment: null,
            };

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
  );
}
