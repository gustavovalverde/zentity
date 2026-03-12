import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEchoTool } from "./echo.js";
import { registerRequestApprovalTool } from "./request-approval.js";

export function registerTools(server: McpServer): void {
  registerEchoTool(server);
  registerRequestApprovalTool(server);
}
