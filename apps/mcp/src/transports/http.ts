import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthContext, runWithAuth } from "../auth/context.js";
import { ensureClientRegistration } from "../auth/dcr.js";
import { discover } from "../auth/discovery.js";
import type { DpopKeyPair } from "../auth/dpop.js";
import { getOrCreateDpopKey } from "../auth/dpop.js";
import { getResourceMetadata } from "../auth/resource-metadata.js";
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

/** Set server-level OAuth credentials (used by startHttp and tests). */
export function setServerCredentials(creds: {
  clientId: string;
  dpopKey: DpopKeyPair;
}): void {
  httpServerCredentials = creds;
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

  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();

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

    const authCtx: AuthContext = {
      accessToken: exchangedToken,
      clientId: httpServerCredentials.clientId,
      dpopKey: httpServerCredentials.dpopKey,
      loginHint: callerSub,
    };

    // Store validated auth info for transport.handleRequest
    c.set("authInfo" as never, result);
    c.set("authCtx" as never, authCtx);

    return next();
  });

  app.post("/mcp", async (c) => {
    const authCtx = c.get("authCtx" as never) as AuthContext;
    const sessionId = c.req.header("mcp-session-id");
    const existing = getTransport(transports, sessionId);

    if (existing) {
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
      await cleanup();
    };
    await server.connect(transport);

    return runWithAuth(authCtx, () => transport.handleRequest(c.req.raw));
  });

  app.get("/mcp", (c) => {
    const authCtx = c.get("authCtx" as never) as AuthContext;
    const sessionId = c.req.header("mcp-session-id");
    const transport = getTransport(transports, sessionId);
    if (!transport) {
      return c.json({ error: "No active session" }, 400);
    }
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
    }
    return c.body(null, 204);
  });

  return app;
}

export async function startHttp(): Promise<void> {
  // Bootstrap OAuth identity: DCR + DPoP keypair for downstream OAuth calls
  const discovery = await discover(config.zentityUrl);
  const clientId = await ensureClientRegistration(discovery);
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
