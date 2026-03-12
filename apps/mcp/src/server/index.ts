import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../tools/index.js";

const VERSION = "0.1.0";

export function createServer(): {
  server: McpServer;
  cleanup: () => Promise<void>;
} {
  const server = new McpServer({
    name: "@zentity/mcp-server",
    version: VERSION,
  });

  registerTools(server);

  const cleanup = async () => {
    await server.close();
  };

  return { server, cleanup };
}
