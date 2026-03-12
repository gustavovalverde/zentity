import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CibaDeniedError,
  CibaTimeoutError,
  requestCibaApproval,
} from "../auth/ciba.js";
import { getAuthContext } from "../auth/context.js";
import { loadCredentials } from "../auth/credentials.js";
import { loadDpopKey } from "../auth/dpop.js";
import { config } from "../config.js";

function buildBindingMessage(action: string, details?: string): string {
  if (details) {
    return `${action}: ${details}`;
  }
  return action;
}

export function registerRequestApprovalTool(server: McpServer): void {
  server.tool(
    "zentity_request_approval",
    "Request user approval for an action via push notification (CIBA)",
    {
      action: z.string().describe("Short description of the action to approve"),
      details: z
        .string()
        .optional()
        .describe("Additional context shown in the notification"),
    },
    async ({ action, details }) => {
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

      const bindingMessage = buildBindingMessage(action, details);
      console.error(`[ciba] Requesting approval: "${bindingMessage}"`);

      try {
        const result = await requestCibaApproval({
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: auth.clientId,
          dpopKey,
          loginHint: auth.loginHint,
          scope: "openid",
          bindingMessage,
          resource: config.zentityUrl,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                approved: true,
                binding_message: bindingMessage,
                has_authorization_details:
                  result.authorizationDetails !== undefined,
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
                text: `User denied: ${error.message}`,
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
                text: "Approval timed out — user did not respond",
              },
            ],
          };
        }
        throw error;
      }
    }
  );
}
