import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckComplianceTool } from "./check-compliance.js";
import { registerMyProfileTool } from "./my-profile.js";
import { registerMyProofsTool } from "./my-proofs.js";
import { registerPurchaseTool } from "./purchase.js";
import { registerWhoamiTool } from "./whoami.js";

export function registerTools(server: McpServer): void {
  registerCheckComplianceTool(server);
  registerMyProfileTool(server);
  registerMyProofsTool(server);
  registerPurchaseTool(server);
  registerWhoamiTool(server);
}
