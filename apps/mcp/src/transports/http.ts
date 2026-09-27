import { serve } from "@hono/node-server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { exchangeToken } from "@zentity/sdk/fpa";
import { deriveAppAudience } from "@zentity/sdk/node";
import { createDpopClientFromKeyPair, type DpopClient } from "@zentity/sdk/rp";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "../config.js";
import {
  discoverMcpOAuth,
  ensureMcpOAuthClientCredentials,
} from "../oauth-client.js";
import {
  type AuthContext,
  type OAuthSessionContext,
  runWithAuthResolver,
} from "../runtime/auth-context.js";
import { createServer } from "../server.js";
import { getResourceMetadata } from "./resource-metadata.js";
import { isAuthError, validateToken } from "./token-auth.js";

const AUTH_SCHEME_PREFIX = /^(DPoP|Bearer)\s+/i;

interface HttpServerCredentials {
  clientId: string;
  dpopClient: DpopClient;
  dpopKey: OAuthSessionContext["dpopKey"];
}

async function exchangeForZentity(
  credentials: HttpServerCredentials,
  callerToken: string
): Promise<AuthContext> {
  const discovery = await discoverMcpOAuth();
  const exchanged = await exchangeToken({
    tokenEndpoint: discovery.token_endpoint,
    subjectToken: callerToken,
    audience: deriveAppAudience(discovery.issuer),
    clientId: credentials.clientId,
    dpopClient: credentials.dpopClient,
  });
  return {
    oauth: {
      accessToken: exchanged.accessToken,
      accountSub: exchanged.accountSub ?? "",
      clientId: credentials.clientId,
      dpopClient: credentials.dpopClient,
      dpopKey: credentials.dpopKey,
      scopes: exchanged.scope?.split(" ").filter(Boolean) ?? [],
    },
  };
}

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

export function createApp(credentials: HttpServerCredentials): Hono {
  const app = new Hono();
  const mcp = createMcpHandler(() => createServer());

  app.use(
    cors({
      origin: (origin) => matchOrigin(origin, config.allowedOrigins) ?? "",
      exposeHeaders: ["DPoP-Nonce", "WWW-Authenticate"],
    })
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json(getResourceMetadata())
  );

  app.all("/mcp", async (c) => {
    const authHeader = c.req.header("authorization");
    const url = new URL(c.req.url);
    url.search = "";
    const result = await validateToken(
      authHeader,
      c.req.header("dpop"),
      c.req.method,
      url.href
    );
    if (isAuthError(result)) {
      return c.json(result.body, result.status, {
        "WWW-Authenticate": result.wwwAuthenticate,
      });
    }

    const callerToken = authHeader?.replace(AUTH_SCHEME_PREFIX, "") ?? "";
    let exchanged: Promise<AuthContext> | undefined;
    const resolveAuth = () => {
      exchanged ??= exchangeForZentity(credentials, callerToken);
      return exchanged;
    };

    const tokenScopes =
      typeof result.payload.scope === "string"
        ? result.payload.scope.split(" ").filter(Boolean)
        : [];
    return runWithAuthResolver(resolveAuth, () =>
      mcp.fetch(c.req.raw, {
        authInfo: {
          token: callerToken,
          clientId: String(result.payload.azp ?? result.payload.client_id),
          scopes: tokenScopes,
          resource: new URL(config.mcpPublicUrl),
        },
      })
    );
  });

  return app;
}

export async function startHttp(): Promise<void> {
  const { clientId, dpopKey } = await ensureMcpOAuthClientCredentials();
  const app = createApp({
    clientId,
    dpopClient: await createDpopClientFromKeyPair(dpopKey),
    dpopKey,
  });
  const { port } = config;

  serve({ fetch: app.fetch, port }, () => {
    console.error(`MCP server listening on http://localhost:${port}`);
    console.error(`  Health: http://localhost:${port}/health`);
    console.error(`  MCP:    http://localhost:${port}/mcp`);
  });
}
