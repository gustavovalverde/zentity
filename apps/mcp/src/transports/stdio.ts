import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureAuthenticated } from "../auth/bootstrap.js";
import { setAuthFactory, setAuthPromise } from "../auth/context.js";
import { createServer } from "../server/index.js";

async function runAuth(): Promise<void> {
  try {
    await ensureAuthenticated();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[auth] Authentication failed: ${msg}`);
  }
}

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

  // Register the auth factory so requireAuth() can retry on failure
  setAuthFactory(runAuth);

  // Start initial auth — tools await this promise before executing.
  // Running after connect() ensures the MCP handshake isn't blocked.
  setAuthPromise(runAuth());
}
