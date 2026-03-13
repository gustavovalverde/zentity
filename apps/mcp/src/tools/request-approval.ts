import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CibaDeniedError,
  CibaTimeoutError,
  requestCibaApproval,
} from "../auth/ciba.js";
import { requireAuth } from "../auth/context.js";
import { config } from "../config.js";

export function registerRequestApprovalTool(server: McpServer): void {
  server.tool(
    "request_approval",
    "Request the user's explicit approval for a sensitive action via push notification. The user must approve or deny on their device before the agent can proceed. Use when the agent needs user consent for something that requires authorization.",
    {
      action: z.string().describe("Short description of the action to approve"),
      details: z
        .string()
        .optional()
        .describe("Additional context shown in the notification"),
    },
    async ({ action, details }) => {
      let auth;
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

      const bindingMessage = details ? `${action}: ${details}` : action;
      console.error(`[ciba] Requesting approval: "${bindingMessage}"`);

      try {
        const result = await requestCibaApproval({
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: auth.clientId,
          dpopKey: auth.dpopKey,
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
