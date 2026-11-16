import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Implementation,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import {
  type RegisteredAgentSession as AgentRuntimeState,
  isAgentSessionInactiveError,
} from "@zentity/sdk";
import type { InstalledOAuthSession } from "@zentity/sdk/node";
import { createDpopClientFromKeyPair, type DpopClient } from "@zentity/sdk/rp";
import { clientInfoOf } from "../agent.js";

export type OAuthSessionContext = InstalledOAuthSession & {
  /** Set for MCP HTTP, which authenticates as a confidential client. */
  clientSecret?: string | undefined;
  dpopClient: DpopClient;
};

export async function withDpopClient(
  session: InstalledOAuthSession
): Promise<OAuthSessionContext> {
  return {
    ...session,
    dpopClient: await createDpopClientFromKeyPair(session.dpopKey),
  };
}

export interface AuthContext {
  oauth: OAuthSessionContext;
  /**
   * Registers a new agent session in place of `runtime` and returns it. Set
   * by the stdio transport, whose process holds one session.
   */
  renewRuntime?: () => Promise<AgentRuntimeState>;
  runtime?: AgentRuntimeState;
}

type AuthResolver = (
  clientInfo: Implementation | undefined
) => Promise<AuthContext>;

const authStorage = new AsyncLocalStorage<AuthContext>();
const requestResolverStorage = new AsyncLocalStorage<AuthResolver>();
let processAuthResolver: AuthResolver | undefined;

/**
 * Registers the resolver used when no request-scoped resolver exists
 * (stdio, where one process serves one user).
 */
export function setProcessAuthResolver(
  resolver: AuthResolver | undefined
): void {
  processAuthResolver = resolver;
}

export function runWithAuth<T>(ctx: AuthContext, fn: () => T): T {
  return authStorage.run(ctx, fn);
}

/** Scopes a lazily resolved auth context to one HTTP request. */
export function runWithAuthResolver<T>(resolver: AuthResolver, fn: () => T): T {
  return requestResolverStorage.run(resolver, fn);
}

export function requireAuth(
  clientInfo?: Implementation | undefined
): Promise<AuthContext> {
  const scoped = authStorage.getStore();
  if (scoped) {
    return Promise.resolve(scoped);
  }
  const requestResolver = requestResolverStorage.getStore();
  if (requestResolver) {
    return requestResolver(clientInfo);
  }
  if (!processAuthResolver) {
    return Promise.reject(
      new Error(
        "Not authenticated — complete the MCP OAuth bootstrap first or check server logs"
      )
    );
  }
  return processAuthResolver(clientInfo);
}

export function getAuthContext(): AuthContext {
  const ctx = authStorage.getStore();
  if (!ctx) {
    throw new Error(
      "Not authenticated — complete the MCP OAuth bootstrap first or check server logs"
    );
  }
  return ctx;
}

export function getOAuthContext(ctx?: AuthContext): OAuthSessionContext {
  return (ctx ?? getAuthContext()).oauth;
}

export function tryGetRuntimeState(
  ctx?: AuthContext
): AgentRuntimeState | undefined {
  return (ctx ?? getAuthContext()).runtime;
}

/**
 * Runs `send` with the agent session and, when Zentity refuses the session's
 * Agent-Assertion because the session is no longer active (idle, past its
 * lifetime, or revoked), registers a new session and runs `send` once more
 * with it. `send` signs its assertion from the session it receives.
 */
export async function withAgentSession<T>(
  auth: AuthContext,
  send: (runtime: AgentRuntimeState | undefined) => Promise<T>
): Promise<T> {
  try {
    return await send(auth.runtime);
  } catch (error) {
    if (
      !(auth.runtime && auth.renewRuntime && isAgentSessionInactiveError(error))
    ) {
      throw error;
    }
    return send(await auth.renewRuntime());
  }
}

/**
 * Wraps a tool callback so it runs inside the caller's auth context. A thrown
 * error, including an auth failure, reaches the client as an `isError` tool
 * result because McpServer converts it, so handlers throw instead of building
 * error results.
 */
export function withToolAuth<Args, R>(
  server: McpServer,
  handler: (args: Args, ctx: ServerContext) => Promise<R>
): (args: Args, ctx: ServerContext) => Promise<R> {
  return async (args, ctx) => {
    const auth = await requireAuth(clientInfoOf(server, ctx));
    return runWithAuth(auth, () => handler(args, ctx));
  };
}
