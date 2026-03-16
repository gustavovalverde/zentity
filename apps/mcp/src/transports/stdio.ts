import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureAuthenticated, refreshAuthContext } from "../auth/bootstrap.js";
import {
  getAuthContext,
  setAuthFactory,
  setAuthPromise,
} from "../auth/context.js";
import { createServer } from "../server/index.js";

const REFRESH_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

async function runAuth(): Promise<void> {
  try {
    const tokenManager = await ensureAuthenticated();
    const auth = getAuthContext();
    setInterval(async () => {
      try {
        await refreshAuthContext(tokenManager, auth.clientId, auth.dpopKey);
        console.error("[auth] Token refreshed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[auth] Token refresh failed: ${msg}`);
      }
    }, REFRESH_INTERVAL_MS);
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
