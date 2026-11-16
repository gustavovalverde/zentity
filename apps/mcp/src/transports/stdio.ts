import type { Implementation } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AgentRegistrationError, buildHostKeyNamespace } from "@zentity/sdk";
import { AGENT_BOOTSTRAP_SCOPES } from "@zentity/sdk/agent-contract";
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

function lacksBootstrapScopes(oauth: OAuthSessionContext): boolean {
  return (
    oauth.scopes.length > 0 &&
    AGENT_BOOTSTRAP_SCOPES.some((scope) => !oauth.scopes.includes(scope))
  );
}

// The SDK reports a refused exchange as `Token exchange failed: <status>
// <body>`; the bootstrap exchange refuses a login without the bootstrap
// scopes (`invalid_scope`) or a delegated one (`invalid_request`).
const REFUSED_BOOTSTRAP_EXCHANGE =
  /^Token exchange failed: 400 .*"error":"(?:invalid_scope|invalid_request)"/;

function isRefusedBootstrapExchange(error: unknown): boolean {
  return (
    error instanceof Error && REFUSED_BOOTSTRAP_EXCHANGE.test(error.message)
  );
}

let signedInAgainForBootstrap = false;

/**
 * Credentials stored before the login carried the bootstrap scopes cannot
 * register an agent. Clears them and signs in again, once per process.
 */
async function signInAgainForBootstrap(
  reason: string
): Promise<OAuthSessionContext | undefined> {
  if (signedInAgainForBootstrap) {
    return undefined;
  }
  signedInAgainForBootstrap = true;
  console.error(`[auth] ${reason}, signing in again...`);
  await clearMcpOAuthTokens();
  return ensureMcpOAuthSession();
}

export async function bootstrapRegisteredRuntime(
  clientInfo: Implementation | undefined
): Promise<AuthContext> {
  let oauth = await ensureMcpOAuthSession();
  if (lacksBootstrapScopes(oauth)) {
    oauth =
      (await signInAgainForBootstrap(
        "Stored credentials lack the agent bootstrap scopes"
      )) ?? oauth;
  }
  try {
    return await registerRuntime(oauth, clientInfo);
  } catch (error) {
    if (isRefusedBootstrapExchange(error)) {
      const fresh = await signInAgainForBootstrap(
        "Zentity refused the stored credentials for agent bootstrap"
      );
      if (fresh) {
        return registerRuntime(fresh, clientInfo);
      }
    }

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
    pending ??= bootstrapRegisteredRuntime(clientInfo).then(
      (auth) => {
        current = auth;
        refreshTimer ??= setInterval(refresh, REFRESH_INTERVAL_MS);
        refreshTimer.unref();
        return auth;
      },
      (error: unknown) => {
        pending = undefined;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[auth] Authentication failed: ${message}`);
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
