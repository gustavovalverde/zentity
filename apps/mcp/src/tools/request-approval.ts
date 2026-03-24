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

      const runtime = requireRuntimeState(auth);
      const oauth = getOAuthContext(auth);
      const rawMessage = details ? `${action}: ${details}` : action;
      const bindingMessage = prefixBindingMessage(
        runtime.display.name,
        rawMessage
      );
      console.error(`[ciba] Requesting approval: "${bindingMessage}"`);

      try {
        const agentAssertion = await signAgentAssertion(
          runtime,
          bindingMessage
        );

        const result = await requestCibaApproval({
          cibaEndpoint: `${config.zentityUrl}/api/auth/oauth2/bc-authorize`,
          tokenEndpoint: `${config.zentityUrl}/api/auth/oauth2/token`,
          clientId: oauth.clientId,
          dpopKey: oauth.dpopKey,
          loginHint: oauth.loginHint,
          scope: "openid",
          bindingMessage,
          resource: config.zentityUrl,
          agentAssertion,
          onPendingApproval: logPendingApprovalHandoff,
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
