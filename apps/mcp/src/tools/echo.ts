import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerEchoTool(server: McpServer): void {
  server.tool(
    "echo",
    "Echo back a message (connectivity test)",
    { message: z.string().describe("Message to echo back") },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    })
  );
}
