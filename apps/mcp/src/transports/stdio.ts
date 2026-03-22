import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { detectAgent } from "../agent.js";
import {
  AgentRegistrationError,
  clearCachedHostId,
  ensureHostRegistered,
  registerAgent,
} from "../auth/agent-registration.js";
import { ensureAuthenticated, refreshAuthContext } from "../auth/bootstrap.js";
import { clearTokenCredentials } from "../auth/credentials.js";
import {
  setAuthFactory,
  setAuthPromise,
  setDefaultAuth,
} from "../auth/context.js";
import { agentRuntimeManager } from "../auth/runtime-manager.js";
import { config } from "../config.js";
import { createServer } from "../server/index.js";

const REFRESH_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function waitForInitialized(server: McpServer): Promise<void> {
  if (server.server.getClientVersion()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const previousHandler = server.server.oninitialized;
    server.server.oninitialized = () => {
      previousHandler?.();
      resolve();
    };
  });
}

export async function bootstrapRegisteredRuntime(
  server: McpServer,
  initializedPromise: Promise<void>
): Promise<
  Awaited<ReturnType<typeof ensureAuthenticated>> & {
    runtime: Awaited<ReturnType<typeof registerAgent>>;
  }
> {
  await initializedPromise;

  const clientInfo = server.server.getClientVersion();
  const display = detectAgent(
    clientInfo
      ? { name: clientInfo.name, version: clientInfo.version }
      : undefined
  );

  let auth = await ensureAuthenticated();

  const registerRuntime = async (
    oauth: (typeof auth)["oauth"]
  ): Promise<Awaited<ReturnType<typeof registerAgent>>> => {
    const hostId = await ensureHostRegistered(
      config.zentityUrl,
      oauth,
      "@zentity/mcp-server"
    );
    return registerAgent(config.zentityUrl, oauth, hostId, display);
  };

  try {
    const runtime = await registerRuntime(auth.oauth);
    return { ...auth, runtime };
  } catch (error) {
    if (error instanceof AgentRegistrationError && error.status === 404) {
      console.error(
        "[auth] Cached host registration is stale, re-registering the durable host..."
      );
      clearCachedHostId(config.zentityUrl, auth.oauth.clientId);
      const runtime = await registerRuntime(auth.oauth);
      return { ...auth, runtime };
    }

    if (error instanceof AgentRegistrationError && error.status === 403) {
      console.error(
        "[auth] Stored credentials no longer satisfy agent registration, re-authenticating..."
      );
      clearTokenCredentials(config.zentityUrl);
      auth = await ensureAuthenticated();
      const runtime = await registerRuntime(auth.oauth);
      return { ...auth, runtime };
    }
    throw error;
  }
}

async function runAuth(
  server: McpServer,
  initializedPromise: Promise<void>
): Promise<void> {
  setDefaultAuth(undefined);
  agentRuntimeManager.clear();

  try {
    const { oauth, runtime, tokenManager } = await bootstrapRegisteredRuntime(
      server,
      initializedPromise
    );
    agentRuntimeManager.setState(runtime);
    setDefaultAuth({ oauth, runtime });

    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    let currentOauth = oauth;
    refreshTimer = setInterval(async () => {
      try {
        currentOauth = await refreshAuthContext(tokenManager, currentOauth);
        const currentRuntime = agentRuntimeManager.getState();
        if (!currentRuntime) {
          throw new Error(
            "Agent runtime is not initialized — complete host and session registration first"
          );
        }
        setDefaultAuth({ oauth: currentOauth, runtime: currentRuntime });
        console.error("[auth] Token refreshed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[auth] Token refresh failed: ${msg}`);
      }
    }, REFRESH_INTERVAL_MS);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[auth] Authentication failed: ${msg}`);
    throw error;
  }
}

export async function startStdio(): Promise<void> {
  const { server, cleanup } = createServer();
  const transport = new StdioServerTransport();
  const initializedPromise = waitForInitialized(server);

  const shutdown = async () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);

  // Tools were registered before connect(), so the SDK's per-tool
  // sendToolListChanged() no-ops (transport wasn't set yet).
  // Once the client finishes the handshake, notify it to fetch tools/list.
  void initializedPromise.then(() => {
    server.server.sendToolListChanged();
  });

  // Register the auth factory so requireAuth() can retry on failure
  setAuthFactory(() => runAuth(server, initializedPromise));

  // Start initial auth — tools await this promise before executing.
  // Running after connect() ensures the MCP handshake isn't blocked, and the
  // promise does not resolve until both OAuth and runtime registration succeed.
  setAuthPromise(runAuth(server, initializedPromise));
}
