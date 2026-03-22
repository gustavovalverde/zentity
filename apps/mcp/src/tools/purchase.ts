import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prefixBindingMessage } from "../agent.js";
import { signAgentAssertion } from "../auth/agent-registration.js";
import {
  CibaDeniedError,
  CibaTimeoutError,
  logPendingApprovalHandoff,
  requestCibaApproval,
} from "../auth/ciba.js";
import {
  type AuthContext,
  getOAuthContext,
  requireAuth,
  requireRuntimeState,
} from "../auth/context.js";
import { redeemRelease } from "../auth/identity.js";
import { config } from "../config.js";

export function registerPurchaseTool(server: McpServer): void {
  server.tool(
    "purchase",
    "Authorize and execute a purchase on behalf of the user. Sends a push notification for the user to approve the transaction, then retrieves their name and address for fulfillment. Use when the user wants to buy, order, or purchase something.",
    {
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
    async ({
      amount,
      currency,
      description,
      item,
      merchant,
      requires_age_verification,
    }) => {
      let auth: AuthContext;
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

      const authorizationDetails = [
        {
          type: "purchase",
          merchant,
          item,
          amount: { value: amount.toFixed(2), currency },
        },
      ];

      const runtime = requireRuntimeState(auth);
      const oauth = getOAuthContext(auth);
      const rawMessage = description
        ? `Purchase ${item} from ${merchant} for ${amount} ${currency}: ${description}`
        : `Purchase ${item} from ${merchant} for ${amount} ${currency}`;
      const bindingMessage = prefixBindingMessage(runtime.display.name, rawMessage);

      try {
        const agentAssertion = await signAgentAssertion(runtime, bindingMessage);

        const result = await requestCibaApproval({
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: oauth.clientId,
          dpopKey: oauth.dpopKey,
          loginHint: oauth.loginHint,
          scope: requires_age_verification
            ? "openid proof:age proof:nationality identity.name identity.address"
            : "openid identity.name identity.address",
          bindingMessage,
          authorizationDetails,
          resource: config.zentityUrl,
          agentAssertion,
          onPendingApproval: logPendingApprovalHandoff,
        });

        const pii = await redeemRelease(result.accessToken, oauth.dpopKey);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                approved: true,
                binding_message: bindingMessage,
                pii: pii ? { name: pii.name, address: pii.address } : null,
              }),
            },
          ],
        };
      } catch (error) {
        if (error instanceof CibaDeniedError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `User denied purchase: ${error.message}`,
              },
            ],
          };
        }
        if (error instanceof CibaTimeoutError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Purchase approval timed out — user did not respond",
              },
            ],
          };
        }
        throw error;
      }
    }
  );
}
