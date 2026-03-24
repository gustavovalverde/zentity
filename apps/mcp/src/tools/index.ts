import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckComplianceTool } from "./check-compliance.js";
import { registerEchoTool } from "./echo.js";
import { registerMyProofsTool } from "./my-proofs.js";
import { registerPurchaseTool } from "./purchase.js";
import { registerRequestApprovalTool } from "./request-approval.js";
import { registerWhoamiTool } from "./whoami.js";

interface ToolRegistrationOptions {
  allowRuntimeTools?: boolean;
}

export function registerTools(
  server: McpServer,
  options: ToolRegistrationOptions = {}
): void {
  registerCheckComplianceTool(server);
  registerEchoTool(server);
  registerMyProofsTool(server);
  registerWhoamiTool(server);

  if (options.allowRuntimeTools) {
    registerPurchaseTool(server);
    registerRequestApprovalTool(server);
  }
}
