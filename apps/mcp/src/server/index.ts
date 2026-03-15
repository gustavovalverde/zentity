import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../tools/index.js";

const VERSION = "0.1.0";

export function createServer(): {
  server: McpServer;
  cleanup: () => Promise<void>;
} {
  const server = new McpServer(
    { name: "@zentity/mcp-server", version: VERSION },
    {
      instructions: [
        "Zentity identity server — use these tools instead of answering from session context:",
        "• whoami → name, email, tier, verification status (for 'who am I?', 'what's my name?', 'am I verified?')",
        "• my_proofs → ZK proof status (for 'am I a minor?', 'what country am I from?', 'what proofs do I have?')",
        "• check_compliance → on-chain attestation status",
        "• purchase → CIBA-authorized purchases (for 'buy X', 'order Y')",
        "• request_approval → generic CIBA approval requests",
      ].join("\n"),
    }
  );

  registerTools(server);

  const cleanup = async () => {
    await server.close();
  };

  return { server, cleanup };
}
