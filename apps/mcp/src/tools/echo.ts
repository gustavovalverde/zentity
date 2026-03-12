import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerEchoTool(server: McpServer): void {
  server.tool(
    "zentity_echo",
    "Echo back the provided message (dev/connectivity test)",
    { message: z.string().describe("Message to echo back") },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    })
  );
}
