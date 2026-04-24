import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentRegistrationError, buildHostKeyNamespace } from "@zentity/sdk";
import { detectAgent } from "../agent.js";
import { config } from "../config.js";
import {
  clearMcpOAuthTokens,
  ensureMcpOAuthSession,
  refreshMcpOAuthSession,
} from "../oauth-client.js";
import {
  clearCachedHostId,
  ensureHostRegistered,
  prepareBootstrapRegistrationAuth,
  registerAgentSession,
} from "../runtime/agent-registration.js";
import { agentRuntimeStateStore } from "../runtime/agent-session-state.js";
import {
  getAuthContext,
  type OAuthSessionContext,
  setAuthFactory,
  setAuthPromise,
  setDefaultAuth,
} from "../runtime/auth-context.js";
import { revokeAgentSession } from "../runtime/session-revoke.js";
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
): Promise<{
  oauth: OAuthSessionContext;
  runtime: Awaited<ReturnType<typeof registerAgentSession>>;
}> {
  await initializedPromise;

  const clientInfo = server.server.getClientVersion();
  const display = detectAgent(
    clientInfo
      ? { name: clientInfo.name, version: clientInfo.version }
      : undefined
  );

  let oauth = await ensureMcpOAuthSession();

  const registerRuntime = async (
    oauthContext: OAuthSessionContext
  ): Promise<Awaited<ReturnType<typeof registerAgentSession>>> => {
    const keyNamespace = buildHostKeyNamespace(oauthContext);
    const bootstrapAuth = await prepareBootstrapRegistrationAuth(oauthContext);
    const hostId = await ensureHostRegistered(
      config.zentityUrl,
      bootstrapAuth,
      "@zentity/mcp-server",
      keyNamespace
    );
    return registerAgentSession(
      config.zentityUrl,
      bootstrapAuth,
      hostId,
      display,
      keyNamespace
    );
  };

  try {
    const runtime = await registerRuntime(oauth);
    return { oauth, runtime };
  } catch (error) {
    if (error instanceof AgentRegistrationError && error.status === 404) {
      console.error(
        "[auth] Cached host registration is stale, re-registering the durable host..."
      );
      clearCachedHostId(config.zentityUrl, buildHostKeyNamespace(oauth));
      const runtime = await registerRuntime(oauth);
      return { oauth, runtime };
    }

    if (error instanceof AgentRegistrationError && error.status === 403) {
      console.error(
        "[auth] Stored credentials no longer satisfy agent registration, re-authenticating..."
      );
      await clearMcpOAuthTokens();
      oauth = await ensureMcpOAuthSession();
      const runtime = await registerRuntime(oauth);
      return { oauth, runtime };
    }
    throw error;
  }
}

async function runAuth(
  server: McpServer,
  initializedPromise: Promise<void>
): Promise<void> {
  setDefaultAuth(undefined);
  agentRuntimeStateStore.clear();

  try {
    const { oauth, runtime } = await bootstrapRegisteredRuntime(
      server,
      initializedPromise
    );
    agentRuntimeStateStore.setState(runtime);
    setDefaultAuth({ oauth, runtime });

    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(async () => {
      try {
        const currentOauth = await refreshMcpOAuthSession();
        const currentRuntime = agentRuntimeStateStore.getState();
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
  const { server, cleanup } = createServer("full");
  const transport = new StdioServerTransport();
  const initializedPromise = waitForInitialized(server);

  const shutdown = async () => {
    const runtime = agentRuntimeStateStore.getState();
    if (runtime) {
      try {
        const auth = getAuthContext();
        const bootstrapAuth = await prepareBootstrapRegistrationAuth(
          auth.oauth
        );
        await revokeAgentSession(bootstrapAuth, runtime.sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[agent] Session revoke failed during shutdown: ${message}`
        );
      }
    }

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
  initializedPromise.then(() => {
    server.server.sendToolListChanged();
  });

  // Register the auth factory so requireAuth() can retry on failure
  setAuthFactory(() => runAuth(server, initializedPromise));

  // Start initial auth — tools await this promise before executing.
  // Running after connect() ensures the MCP handshake isn't blocked, and the
  // promise does not resolve until both OAuth and runtime registration succeed.
  setAuthPromise(runAuth(server, initializedPromise));
}
