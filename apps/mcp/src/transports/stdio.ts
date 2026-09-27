import type { Implementation } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
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
import {
  type AuthContext,
  type OAuthSessionContext,
  setProcessAuthResolver,
} from "../runtime/auth-context.js";
import { revokeAgentSession } from "../runtime/session-revoke.js";
import { createServer } from "../server.js";

const REFRESH_INTERVAL_MS = 4 * 60 * 1000;

async function registerRuntime(
  oauth: OAuthSessionContext,
  clientInfo: Implementation | undefined
): Promise<AuthContext> {
  const display = detectAgent(clientInfo);
  const keyNamespace = buildHostKeyNamespace(oauth);
  const bootstrapAuth = await prepareBootstrapRegistrationAuth(oauth);
  const hostId = await ensureHostRegistered(
    config.zentityUrl,
    bootstrapAuth,
    "@zentity/mcp-server",
    keyNamespace
  );
  const runtime = await registerAgentSession(
    config.zentityUrl,
    bootstrapAuth,
    hostId,
    display,
    keyNamespace
  );
  return { oauth, runtime };
}

export async function bootstrapRegisteredRuntime(
  oauthSession: Promise<OAuthSessionContext>,
  clientInfo: Implementation | undefined
): Promise<AuthContext> {
  const oauth = await oauthSession;
  try {
    return await registerRuntime(oauth, clientInfo);
  } catch (error) {
    if (error instanceof AgentRegistrationError && error.status === 404) {
      console.error(
        "[auth] Cached host registration is stale, re-registering the durable host..."
      );
      clearCachedHostId(config.zentityUrl, buildHostKeyNamespace(oauth));
      return registerRuntime(oauth, clientInfo);
    }

    if (error instanceof AgentRegistrationError && error.status === 403) {
      console.error(
        "[auth] Stored credentials no longer satisfy agent registration, re-authenticating..."
      );
      await clearMcpOAuthTokens();
      return registerRuntime(await ensureMcpOAuthSession(), clientInfo);
    }
    throw error;
  }
}

export function startStdio(): void {
  let oauthSession = ensureMcpOAuthSession();
  oauthSession.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth] Authentication failed: ${message}`);
  });

  let current: AuthContext | undefined;
  let pending: Promise<AuthContext> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  const refresh = async () => {
    try {
      const oauth = await refreshMcpOAuthSession();
      if (current) {
        current = { ...current, oauth };
      }
      console.error("[auth] Token refreshed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[auth] Token refresh failed: ${message}`);
    }
  };

  setProcessAuthResolver((clientInfo) => {
    if (current) {
      return Promise.resolve(current);
    }
    pending ??= bootstrapRegisteredRuntime(oauthSession, clientInfo).then(
      (auth) => {
        current = auth;
        refreshTimer ??= setInterval(refresh, REFRESH_INTERVAL_MS);
        refreshTimer.unref();
        return auth;
      },
      (error: unknown) => {
        pending = undefined;
        oauthSession = ensureMcpOAuthSession();
        throw error;
      }
    );
    return pending;
  });

  const handle = serveStdio(() => createServer());

  const shutdown = async () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    if (current?.runtime) {
      try {
        const bootstrapAuth = await prepareBootstrapRegistrationAuth(
          current.oauth
        );
        await revokeAgentSession(bootstrapAuth, current.runtime.sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[agent] Session revoke failed during shutdown: ${message}`
        );
      }
    }
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
