import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../tools/index.js";

const VERSION = "0.1.0";

type ServerSurface = "full" | "remote";

export function createServer(surface?: ServerSurface): {
  server: McpServer;
  cleanup: () => Promise<void>;
};
export function createServer(surface: ServerSurface = "full"): {
  server: McpServer;
  cleanup: () => Promise<void>;
} {
  const server = new McpServer(
    { name: "@zentity/mcp-server", version: VERSION },
    {
      instructions: [
        "Zentity identity server — use these tools instead of answering from session context:",
        "• whoami → safe account summary only (for 'who am I?', 'am I verified?', 'what tier am I?')",
        "• my_profile → vault-gated profile data (for 'what's my full name?', 'what is my address?', 'what is my birthdate?'; omit fields to fetch the full available profile set)",
        "• my_proofs → proof and verification-derived facts (for 'what proofs do I have?', 'am I over 18?')",
        "• check_compliance → on-chain attestation and compliance status",
        "• purchase → browser-authorized purchase flow",
        "Do not invent approval workflows yourself. If profile data or a purchase requires browser action, the owning tool will initiate that flow directly.",
      ].join("\n"),
    }
  );

  registerTools(server);

  const cleanup = async () => {
    await server.close();
  };

  return { server, cleanup };
}
