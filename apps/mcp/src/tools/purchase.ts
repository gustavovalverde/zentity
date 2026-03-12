import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zentityFetch } from "../auth/api-client.js";
import {
  CibaDeniedError,
  CibaTimeoutError,
  requestCibaApproval,
} from "../auth/ciba.js";
import { getAuthContext } from "../auth/context.js";
import { loadCredentials } from "../auth/credentials.js";
import { loadDpopKey } from "../auth/dpop.js";
import { config } from "../config.js";

interface ReleasedPii {
  address?: string;
  name?: string;
}

export function registerPurchaseTool(server: McpServer): void {
  server.tool(
    "zentity_purchase",
    "Request purchase authorization with PII release (name, address) via CIBA",
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
      const auth = getAuthContext();
      const creds = loadCredentials(config.zentityUrl);
      if (!creds) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Not authenticated" }],
        };
      }

      const dpopKey = loadDpopKey(creds);
      if (!dpopKey) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "No DPoP key available" }],
        };
      }

      const authorizationDetails = [
        { type: "purchase", merchant, amount, currency, item },
      ];
      const bindingMessage = description
        ? `Purchase ${item} from ${merchant} for ${amount} ${currency}: ${description}`
        : `Purchase ${item} from ${merchant} for ${amount} ${currency}`;

      console.error(`[ciba] Requesting purchase approval: "${bindingMessage}"`);

      try {
        await requestCibaApproval({
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: auth.clientId,
          dpopKey,
          loginHint: auth.loginHint,
          scope: "openid identity.name identity.address",
          bindingMessage,
          authorizationDetails,
          resource: config.zentityUrl,
        });

        // Fetch PII using the CIBA-issued token
        const pii = await fetchReleasedPii(dpopKey);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                approved: true,
                binding_message: bindingMessage,
                pii: pii ?? null,
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

async function fetchReleasedPii(
  dpopKey: Parameters<typeof zentityFetch>[1]
): Promise<ReleasedPii | undefined> {
  try {
    const url = `${config.zentityUrl}/api/auth/oauth2/userinfo`;
    const response = await zentityFetch(url, dpopKey);

    if (!response.ok) {
      console.error(
        `[purchase] PII release failed: ${response.status} — user may not have unlocked vault`
      );
      return undefined;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const pii: ReleasedPii = {};
    if (typeof data.name === "string") {
      pii.name = data.name;
    }
    if (typeof data.address === "string") {
      pii.address = data.address;
    }

    return pii.name || pii.address ? pii : undefined;
  } catch {
    console.error("[purchase] PII release request failed");
    return undefined;
  }
}
