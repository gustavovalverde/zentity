import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  AgentRegistrationError,
  clearCachedHostId,
  ensureHostRegistered,
  registerAgent,
} from "../auth/agent-registration.js";
import {
  type AuthContext,
  type OAuthSessionContext,
  runWithAuth,
} from "../auth/context.js";
import { loadCredentials, updateCredentials } from "../auth/credentials.js";
import { ensureClientRegistration } from "../auth/dcr.js";
import type { DiscoveryState } from "../auth/discovery.js";
import { discover } from "../auth/discovery.js";
import type { DpopKeyPair } from "../auth/dpop.js";
import { getOrCreateDpopKey } from "../auth/dpop.js";
import { getResourceMetadata } from "../auth/resource-metadata.js";
import type { AgentRuntimeState } from "../auth/runtime-manager.js";
import { isAuthError, validateToken } from "../auth/token-auth.js";
import { exchangeToken } from "../auth/token-exchange.js";
import { config } from "../config.js";
import { createServer } from "../server/index.js";

const DPOP_PREFIX = /^DPoP\s+/i;
const BEARER_PREFIX = /^Bearer\s+/i;
const AUTH_ISSUER_SUFFIX = /\/api\/auth\/?$/;

let httpServerCredentials:
  | { clientId: string; dpopKey: DpopKeyPair }
  | undefined;

const HTTP_RUNTIME_DISPLAY = {
  model: "unknown",
  name: process.env.ZENTITY_AGENT_NAME ?? "@zentity/mcp-server",
  runtime: "node",
  version: process.env.ZENTITY_AGENT_VERSION ?? "unknown",
} as const;

/** Set server-level OAuth credentials (used by startHttp and tests). */
export function setServerCredentials(creds: {
  clientId: string;
  dpopKey: DpopKeyPair;
}): void {
  httpServerCredentials = creds;
}

function hasRuntimeRegistrationScope(scope: unknown): boolean {
  return typeof scope === "string" && scope.split(" ").includes("agent:manage");
}

export function buildHttpRuntimeKeyNamespace(
  oauth: Pick<OAuthSessionContext, "clientId" | "loginHint">
): string {
  return `${oauth.clientId}:${oauth.loginHint}`;
}

export async function registerHttpRuntime(
  oauth: OAuthSessionContext,
  scope: unknown
): Promise<AgentRuntimeState | undefined> {
  if (!hasRuntimeRegistrationScope(scope)) {
    return undefined;
  }

  const keyNamespace = buildHttpRuntimeKeyNamespace(oauth);

  const registerRuntime = async () => {
    const hostId = await ensureHostRegistered(
      config.zentityUrl,
      oauth,
      HTTP_RUNTIME_DISPLAY.name,
      keyNamespace
    );
    return registerAgent(
      config.zentityUrl,
      oauth,
      hostId,
      HTTP_RUNTIME_DISPLAY,
      keyNamespace
    );
  };

  try {
    return await registerRuntime();
  } catch (error) {
    if (error instanceof AgentRegistrationError && error.status === 404) {
      clearCachedHostId(config.zentityUrl, keyNamespace);
      return registerRuntime();
    }
    throw error;
  }
}

export async function ensureSessionRuntime(
  runtimes: Map<string, AgentRuntimeState>,
  sessionId: string,
  oauth: OAuthSessionContext,
  scope: unknown
): Promise<AgentRuntimeState | undefined> {
  const existing = runtimes.get(sessionId);
  if (existing) {
    return existing;
  }

  const runtime = await registerHttpRuntime(oauth, scope);
  if (runtime) {
    runtimes.set(sessionId, runtime);
  }
  return runtime;
}

function getTransport(
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  sessionId: string | undefined
): WebStandardStreamableHTTPServerTransport | undefined {
  if (sessionId) {
    return transports.get(sessionId);
  }
  return undefined;
}

/** Match origin against allowed patterns (supports wildcard port). */
export function matchOrigin(
  origin: string,
  patterns: string[]
): string | undefined {
  for (const pattern of patterns) {
    if (pattern === origin) {
      return origin;
    }

    // Handle wildcard port: "http://localhost:*" matches "http://localhost:3000"
    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -1); // "http://localhost:"
      if (origin.startsWith(prefix)) {
        return origin;
      }
    }
  }
  return undefined;
}

/**
 * Derive the canonical app audience from the discovered auth issuer.
 * Zentity serves its issuer from `${appUrl}/api/auth`.
 */
export function resolveTokenExchangeAudience(issuer: string): string {
  const normalizedIssuer = issuer.replace(/\/+$/, "");
  if (!AUTH_ISSUER_SUFFIX.test(normalizedIssuer)) {
    return normalizedIssuer;
  }

  const issuerUrl = new URL(normalizedIssuer);
  const appPath = issuerUrl.pathname.replace(AUTH_ISSUER_SUFFIX, "");
  issuerUrl.pathname = appPath || "/";
  issuerUrl.search = "";
  issuerUrl.hash = "";
  return issuerUrl.toString().replace(/\/+$/, "");
}

/** Build the Hono app with all middleware and routes. Separated from `startHttp` for testability. */
export function createApp(): Hono {
  const app = new Hono();

  app.use(
    cors({
      origin: (origin) => matchOrigin(origin, config.allowedOrigins) ?? "",
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "DPoP",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "DPoP-Nonce"],
    })
  );

  // Unauthenticated endpoints
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json(getResourceMetadata())
  );

  app.get("/.well-known/oauth-client.json", (c) => {
    const clientId = `${config.mcpPublicUrl}/.well-known/oauth-client.json`;
    return c.json(
      {
        client_id: clientId,
        client_name: "@zentity/mcp-server",
        redirect_uris: ["http://127.0.0.1/callback"],
        grant_types: [
          "authorization_code",
          "refresh_token",
          "urn:openid:params:grant-type:ciba",
          "urn:ietf:params:oauth:grant-type:token-exchange",
        ],
        token_endpoint_auth_method: "none",
        scope:
          "openid email proof:identity identity.name identity.address agent:manage",
      },
      200,
      {
        "Cache-Control": "max-age=86400",
        "Content-Type": "application/json",
      }
    );
  });

  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  const runtimes = new Map<string, AgentRuntimeState>();

  // Auth middleware for /mcp routes
  app.use("/mcp", async (c, next) => {
    const authHeader = c.req.header("authorization");
    const dpopHeader = c.req.header("dpop");
    const method = c.req.method;
    const fullHref = new URL(c.req.url).href;
    const url = fullHref.split("?")[0] ?? fullHref; // Strip query params for htu

    const result = await validateToken(authHeader, dpopHeader, method, url);

    if (isAuthError(result)) {
      return c.json(result.body, result.status, {
        "WWW-Authenticate": result.wwwAuthenticate,
      });
    }

    if (!httpServerCredentials) {
      return c.json({ error: "Server not bootstrapped" }, 503);
    }

    // RFC 8693 token exchange: exchange caller's token for an MCP-bound token
    const callerToken =
      authHeader?.replace(DPOP_PREFIX, "").replace(BEARER_PREFIX, "") ?? "";
    const callerSub = (result.payload.sub as string) ?? "";

    let exchangedToken: string;
    try {
      const discovery = await discover(config.zentityUrl);
      const exchangeResult = await exchangeToken({
        tokenEndpoint: discovery.token_endpoint,
        subjectToken: callerToken,
        audience: resolveTokenExchangeAudience(discovery.issuer),
        clientId: httpServerCredentials.clientId,
        dpopKey: httpServerCredentials.dpopKey,
      });
      exchangedToken = exchangeResult.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: "token_exchange_failed", error_description: message },
        502
      );
    }

    const oauth: OAuthSessionContext = {
      accessToken: exchangedToken,
      clientId: httpServerCredentials.clientId,
      dpopKey: httpServerCredentials.dpopKey,
      loginHint: callerSub,
    };

    // Store validated auth info for transport.handleRequest
    c.set("authInfo" as never, result);
    c.set("oauthCtx" as never, oauth);
    c.set("validatedScope" as never, result.payload.scope);

    return next();
  });

  app.post("/mcp", async (c) => {
    const oauth = c.get("oauthCtx" as never) as OAuthSessionContext;
    const scope = c.get("validatedScope" as never) as unknown;
    const sessionId = c.req.header("mcp-session-id");
    const existing = getTransport(transports, sessionId);

    if (existing) {
      let runtime: AgentRuntimeState | undefined;
      try {
        runtime = sessionId
          ? await ensureSessionRuntime(runtimes, sessionId, oauth, scope)
          : undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json(
          { error: "runtime_registration_failed", error_description: message },
          502
        );
      }
      const authCtx: AuthContext = runtime ? { oauth, runtime } : { oauth };
      return runWithAuth(authCtx, () => existing.handleRequest(c.req.raw));
    }

    const newSessionId = randomUUID();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });
    transports.set(newSessionId, transport);

    const { server, cleanup } = createServer();
    transport.onclose = async () => {
      transports.delete(newSessionId);
      runtimes.delete(newSessionId);
      await cleanup();
    };
    await server.connect(transport);

    let runtime: AgentRuntimeState | undefined;
    try {
      runtime = await ensureSessionRuntime(runtimes, newSessionId, oauth, scope);
    } catch (err) {
      transports.delete(newSessionId);
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: "runtime_registration_failed", error_description: message },
        502
      );
    }

    const authCtx: AuthContext = runtime ? { oauth, runtime } : { oauth };
    return runWithAuth(authCtx, () => transport.handleRequest(c.req.raw));
  });

  app.get("/mcp", async (c) => {
    const oauth = c.get("oauthCtx" as never) as OAuthSessionContext;
    const scope = c.get("validatedScope" as never) as unknown;
    const sessionId = c.req.header("mcp-session-id");
    const transport = getTransport(transports, sessionId);
    if (!transport) {
      return c.json({ error: "No active session" }, 400);
    }
    let runtime: AgentRuntimeState | undefined;
    try {
      runtime = sessionId
        ? await ensureSessionRuntime(runtimes, sessionId, oauth, scope)
        : undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: "runtime_registration_failed", error_description: message },
        502
      );
    }
    const authCtx: AuthContext = runtime ? { oauth, runtime } : { oauth };
    return runWithAuth(authCtx, () => transport.handleRequest(c.req.raw));
  });

  app.delete("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    const transport = getTransport(transports, sessionId);
    if (!transport) {
      return c.json({ error: "No active session" }, 400);
    }
    await transport.close();
    if (sessionId) {
      transports.delete(sessionId);
      runtimes.delete(sessionId);
    }
    return c.body(null, 204);
  });

  return app;
}

/**
 * CIMD-first client registration per MCP Authorization Spec priority order:
 * 1. If HTTP transport AND AS supports CIMD → return computed CIMD URL (no network call)
 * 2. Otherwise → fall back to DCR
 */
async function resolveClientId(discovery: DiscoveryState): Promise<string> {
  // Check if the existing credentials already have a method
  const existing = loadCredentials(config.zentityUrl);
  if (existing?.clientId && existing.registrationMethod === "cimd") {
    console.error(`[cimd] Reusing CIMD client_id: ${existing.clientId}`);
    return existing.clientId;
  }

  // CIMD-first: if AS supports CIMD, use the deterministic URL
  if (discovery.client_id_metadata_document_supported) {
    const cimdClientId = `${config.mcpPublicUrl}/.well-known/oauth-client.json`;
    console.error(`[cimd] Using CIMD client_id: ${cimdClientId}`);
    updateCredentials(config.zentityUrl, {
      clientId: cimdClientId,
      registrationMethod: "cimd",
    });
    return cimdClientId;
  }

  // Fallback to DCR
  console.error("[cimd] AS does not support CIMD, falling back to DCR");
  const clientId = await ensureClientRegistration(discovery);
  updateCredentials(config.zentityUrl, { registrationMethod: "dcr" });
  return clientId;
}

export async function startHttp(): Promise<void> {
  // Bootstrap OAuth identity: CIMD-first + DPoP keypair for downstream OAuth calls
  const discovery = await discover(config.zentityUrl);
  const clientId = await resolveClientId(discovery);
  const dpopKey = await getOrCreateDpopKey(config.zentityUrl);
  httpServerCredentials = { clientId, dpopKey };

  const app = createApp();
  const { port } = config;

  serve({ fetch: app.fetch, port }, () => {
    console.error(`MCP server listening on http://localhost:${port}`);
    console.error(`  Health: http://localhost:${port}/health`);
    console.error(`  MCP:    http://localhost:${port}/mcp`);
  });
}
