import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type ExchangeTokenResult, exchangeToken } from "@zentity/sdk/fpa";
import { deriveAppAudience } from "@zentity/sdk/node";
import { createDpopClientFromKeyPair, type DpopClient } from "@zentity/sdk/rp";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type OAuthSessionContext, runWithAuth } from "../auth/context.js";
import {
  getMinimalMcpScopes,
  getRequiredScopesForRemoteRequest,
} from "../auth/mcp-scope-policy.js";
import { getResourceMetadata } from "../auth/resource-metadata.js";
import {
  isAuthError,
  type TokenAuthResult,
  validateToken,
} from "../auth/token-auth.js";
import { config } from "../config.js";
import {
  buildMcpRemoteClientMetadata,
  discoverMcpOAuth,
  ensureMcpOAuthClientCredentials,
} from "../oauth-client.js";
import { createServer } from "../server/index.js";

const DPOP_PREFIX = /^DPoP\s+/i;
const BEARER_PREFIX = /^Bearer\s+/i;

interface HttpServerCredentials {
  clientId: string;
  dpopClient: DpopClient;
  dpopKey: OAuthSessionContext["dpopKey"];
}

let httpServerCredentials: HttpServerCredentials | undefined;

interface HttpSessionEntry {
  principalKey: string;
  transport: WebStandardStreamableHTTPServerTransport;
}

/** Set server-level OAuth credentials (used by startHttp and tests). */
export function setServerCredentials(creds: HttpServerCredentials): void {
  httpServerCredentials = creds;
}

function getTransport(
  transports: Map<string, HttpSessionEntry>,
  sessionId: string | undefined
): HttpSessionEntry | undefined {
  return sessionId ? transports.get(sessionId) : undefined;
}

function extractCnfJkt(result: TokenAuthResult): string {
  const cnf = result.payload.cnf;
  if (
    cnf &&
    typeof cnf === "object" &&
    "jkt" in cnf &&
    typeof (cnf as Record<string, unknown>).jkt === "string"
  ) {
    return (cnf as Record<string, unknown>).jkt as string;
  }

  return "";
}

function buildPrincipalKey(result: TokenAuthResult): string {
  return JSON.stringify({
    azp:
      (result.payload.azp as string | undefined) ??
      (result.payload.client_id as string | undefined) ??
      "",
    iss: (result.payload.iss as string | undefined) ?? "",
    jkt: extractCnfJkt(result),
    sub: (result.payload.sub as string | undefined) ?? "",
  });
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

    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -1);
      if (origin.startsWith(prefix)) {
        return origin;
      }
    }
  }
  return undefined;
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

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json(getResourceMetadata())
  );

  app.get("/.well-known/oauth-client.json", (c) => {
    return c.json(buildMcpRemoteClientMetadata(), 200, {
      "Cache-Control": "max-age=86400",
      "Content-Type": "application/json",
    });
  });

  const transports = new Map<string, HttpSessionEntry>();

  app.use("/mcp", async (c, next) => {
    const authHeader = c.req.header("authorization");
    const dpopHeader = c.req.header("dpop");
    const method = c.req.method;
    const fullHref = new URL(c.req.url).href;
    const url = fullHref.split("?")[0] ?? fullHref;
    const requiredScopes = await getRequiredScopesForRemoteRequest(c.req.raw);

    const result = await validateToken(
      authHeader,
      dpopHeader,
      method,
      url,
      requiredScopes
    );

    if (isAuthError(result)) {
      return c.json(result.body, result.status, {
        "WWW-Authenticate": result.wwwAuthenticate,
      });
    }

    if (!httpServerCredentials) {
      return c.json({ error: "Server not bootstrapped" }, 503);
    }

    const callerToken =
      authHeader?.replace(DPOP_PREFIX, "").replace(BEARER_PREFIX, "") ?? "";
    let exchangeResult: ExchangeTokenResult;
    let exchangedToken: string;
    let exchangedScopes = getMinimalMcpScopes();
    try {
      const discovery = await discoverMcpOAuth();
      exchangeResult = await exchangeToken({
        tokenEndpoint: discovery.token_endpoint,
        subjectToken: callerToken,
        audience: deriveAppAudience(discovery.issuer),
        clientId: httpServerCredentials.clientId,
        dpopClient: httpServerCredentials.dpopClient,
      });
      exchangedToken = exchangeResult.accessToken;
      exchangedScopes =
        typeof exchangeResult.scope === "string"
          ? exchangeResult.scope.split(" ").filter(Boolean)
          : exchangedScopes;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: "token_exchange_failed", error_description: message },
        502
      );
    }

    const oauth: OAuthSessionContext = {
      accessToken: exchangedToken,
      accountSub: exchangeResult.accountSub ?? "",
      clientId: httpServerCredentials.clientId,
      dpopKey: httpServerCredentials.dpopKey,
      loginHint: exchangeResult.loginHint ?? "",
      scopes: exchangedScopes,
    };

    c.set("authInfo" as never, result);
    c.set("oauthCtx" as never, oauth);
    c.set("principalKey" as never, buildPrincipalKey(result));

    return next();
  });

  app.post("/mcp", async (c) => {
    const oauth = c.get("oauthCtx" as never) as OAuthSessionContext;
    const principalKey = c.get("principalKey" as never) as string;
    const sessionId = c.req.header("mcp-session-id");
    const existing = getTransport(transports, sessionId);

    if (existing) {
      if (existing.principalKey !== principalKey) {
        return c.json({ error: "Session principal mismatch" }, 403);
      }
      return runWithAuth({ oauth }, () =>
        existing.transport.handleRequest(c.req.raw)
      );
    }

    const newSessionId = randomUUID();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });
    transports.set(newSessionId, { principalKey, transport });

    const { server, cleanup } = createServer("remote");
    transport.onclose = async () => {
      transports.delete(newSessionId);
      await cleanup();
    };
    await server.connect(transport);

    return runWithAuth({ oauth }, () => transport.handleRequest(c.req.raw));
  });

  app.get("/mcp", (c) => {
    const oauth = c.get("oauthCtx" as never) as OAuthSessionContext;
    const principalKey = c.get("principalKey" as never) as string;
    const sessionId = c.req.header("mcp-session-id");
    const entry = getTransport(transports, sessionId);
    if (!entry) {
      return c.json({ error: "No active session" }, 400);
    }
    if (entry.principalKey !== principalKey) {
      return c.json({ error: "Session principal mismatch" }, 403);
    }
    return runWithAuth({ oauth }, () =>
      entry.transport.handleRequest(c.req.raw)
    );
  });

  app.delete("/mcp", async (c) => {
    const principalKey = c.get("principalKey" as never) as string;
    const sessionId = c.req.header("mcp-session-id");
    const entry = getTransport(transports, sessionId);
    if (!entry) {
      return c.json({ error: "No active session" }, 400);
    }
    if (entry.principalKey !== principalKey) {
      return c.json({ error: "Session principal mismatch" }, 403);
    }
    await entry.transport.close();
    if (sessionId) {
      transports.delete(sessionId);
    }
    return c.body(null, 204);
  });

  return app;
}

export async function startHttp(): Promise<void> {
  const { clientId, dpopKey } = await ensureMcpOAuthClientCredentials();
  httpServerCredentials = {
    clientId,
    dpopClient: await createDpopClientFromKeyPair(dpopKey),
    dpopKey,
  };

  const app = createApp();
  const { port } = config;

  serve({ fetch: app.fetch, port }, () => {
    console.error(`MCP server listening on http://localhost:${port}`);
    console.error(`  Health: http://localhost:${port}/health`);
    console.error(`  MCP:    http://localhost:${port}/mcp`);
  });
}
