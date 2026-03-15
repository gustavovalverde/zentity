import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthContext, runWithAuth } from "../auth/context.js";
import { getResourceMetadata } from "../auth/resource-metadata.js";
import { isAuthError, validateToken } from "../auth/token-auth.js";
import { config } from "../config.js";
import { createServer } from "../server/index.js";

const AUTH_TOKEN_RE = /\s+/;

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
function matchOrigin(origin: string, patterns: string[]): string | undefined {
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

export function startHttp(): void {
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
    const url = new URL(c.req.url).href.split("?")[0]; // Strip query params for htu

    const result = await validateToken(authHeader, dpopHeader, method, url);

    if (isAuthError(result)) {
      return c.json(result.body, result.status, {
        "WWW-Authenticate": result.wwwAuthenticate,
      });
    }

    // Build AuthContext from validated token (authHeader guaranteed non-null after validateToken succeeds)
    const rawToken = (authHeader ?? "").split(AUTH_TOKEN_RE)[1] ?? "";
    const authCtx: AuthContext = {
      accessToken: rawToken,
      clientId:
        (result.payload.client_id as string) ??
        (result.payload.azp as string) ??
        "",
      dpopKey: result.dpopPublicJwk
        ? { privateJwk: {}, publicJwk: result.dpopPublicJwk }
        : { privateJwk: {}, publicJwk: {} },
      loginHint: (result.payload.sub as string) ?? "",
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

  const { port } = config;

  serve({ fetch: app.fetch, port }, () => {
    console.error(`MCP server listening on http://localhost:${port}`);
    console.error(`  Health: http://localhost:${port}/health`);
    console.error(`  MCP:    http://localhost:${port}/mcp`);
  });
}
