import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckComplianceTool } from "./check-compliance.js";
import { registerEchoTool } from "./echo.js";
import { registerMyProofsTool } from "./my-proofs.js";
import { registerPurchaseTool } from "./purchase.js";
import { registerRequestApprovalTool } from "./request-approval.js";
import { registerWhoamiTool } from "./whoami.js";

export function registerTools(server: McpServer): void {
  registerCheckComplianceTool(server);
  registerEchoTool(server);
  registerMyProofsTool(server);
  registerPurchaseTool(server);
  registerRequestApprovalTool(server);
  registerWhoamiTool(server);
}
