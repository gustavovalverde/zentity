import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CibaDeniedError,
  CibaTimeoutError,
  requestCibaApproval,
} from "../auth/ciba.js";
import { type AuthContext, requireAuth } from "../auth/context.js";
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
    },
    async ({ amount, currency, description, item, merchant }) => {
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
        { type: "purchase", merchant, amount, currency, item },
      ];
      const bindingMessage = description
        ? `Purchase ${item} from ${merchant} for ${amount} ${currency}: ${description}`
        : `Purchase ${item} from ${merchant} for ${amount} ${currency}`;

      try {
        const result = await requestCibaApproval({
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: auth.clientId,
          dpopKey: auth.dpopKey,
          loginHint: auth.loginHint,
          scope: "openid identity.name identity.address",
          bindingMessage,
          authorizationDetails,
          resource: config.zentityUrl,
        });

        const pii = await redeemRelease(result.accessToken, auth.dpopKey);

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
