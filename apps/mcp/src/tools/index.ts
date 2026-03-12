import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckComplianceTool } from "./check-compliance.js";
import { registerEchoTool } from "./echo.js";
import { registerRequestApprovalTool } from "./request-approval.js";
import { registerVerifyIdentityTool } from "./verify-identity.js";

export function registerTools(server: McpServer): void {
  registerCheckComplianceTool(server);
  registerEchoTool(server);
  registerRequestApprovalTool(server);
  registerVerifyIdentityTool(server);
}
