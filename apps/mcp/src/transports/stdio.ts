import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureAuthenticated } from "../auth/bootstrap.js";
import { createServer } from "../server/index.js";

export async function startStdio(): Promise<void> {
  const { server, cleanup } = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);

  // Authenticate after connecting — tools are available immediately but
  // auth-requiring ones will fail until this completes. Running after
  // connect() ensures the MCP handshake isn't blocked by auth.
  try {
    await ensureAuthenticated();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[auth] Authentication failed: ${msg}`);
    console.error("[auth] Tools requiring auth will return errors.");
  }
}
