import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { serve } from "@hono/node-server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { exchangeToken } from "@zentity/sdk/fpa";
import { deriveAppAudience, normalizeUrl } from "@zentity/sdk/node";
import { createDpopClientFromKeyPair, type DpopClient } from "@zentity/sdk/rp";
import {
  createInMemoryDpopReplayStore,
  DPOP_SIGNING_ALGORITHMS,
  stripAccessTokenAuthorizationScheme,
} from "better-auth/oauth2";
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

const SCOPES_SUPPORTED = [
  "openid",
  "email",
  "compliance:read",
  "proof:identity",
];

interface HttpServerCredentials {
  clientId: string;
  dpopClient: DpopClient;
  dpopKey: OAuthSessionContext["dpopKey"];
}

interface AuthorizationServer {
  issuer: string;
  jwksUrl: string;
  tokenEndpoint: string;
}

async function exchangeForZentity(
  credentials: HttpServerCredentials,
  authorizationServer: AuthorizationServer,
  callerToken: string
): Promise<AuthContext> {
  const exchanged = await exchangeToken({
    tokenEndpoint: authorizationServer.tokenEndpoint,
    subjectToken: callerToken,
    audience: deriveAppAudience(authorizationServer.issuer),
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

export function createApp(
  credentials: HttpServerCredentials,
  authorizationServer: AuthorizationServer
): Hono {
  const resource = normalizeUrl(config.mcpPublicUrl);
  const resourceMetadataUrl = `${resource}/.well-known/oauth-protected-resource`;
  const mcp = createMcpHandler(() => createServer());

  const handleMcpRequest = createMcpProtectedRequestHandler(
    {
      issuer: authorizationServer.issuer,
      audience: resource,
      jwksUrl: authorizationServer.jwksUrl,
      requiredScopes: ["openid"],
      dpop: { replayStore: createInMemoryDpopReplayStore() },
    },
    (request, claims) => {
      const callerToken = stripAccessTokenAuthorizationScheme(
        request.headers.get("authorization") ?? ""
      );
      let exchanged: Promise<AuthContext> | undefined;
      const resolveAuth = () => {
        exchanged ??= exchangeForZentity(
          credentials,
          authorizationServer,
          callerToken
        );
        return exchanged;
      };

      return runWithAuthResolver(resolveAuth, () =>
        mcp.fetch(request, {
          authInfo: {
            token: callerToken,
            clientId: String(claims.azp ?? claims.client_id),
            scopes:
              typeof claims.scope === "string" ? claims.scope.split(" ") : [],
            resource: new URL(resource),
            resourceMetadataUrl,
          },
        })
      );
    }
  );

  const app = new Hono();

  app.use(
    cors({
      origin: (origin) => matchOrigin(origin, config.allowedOrigins) ?? "",
      exposeHeaders: ["DPoP-Nonce", "WWW-Authenticate"],
    })
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json({
      resource,
      authorization_servers: [authorizationServer.issuer],
      scopes_supported: SCOPES_SUPPORTED,
      bearer_methods_supported: ["header"],
      dpop_signing_alg_values_supported: [...DPOP_SIGNING_ALGORITHMS],
    })
  );

  app.all("/mcp", (c) => handleMcpRequest(c.req.raw));

  return app;
}

export async function startHttp(): Promise<void> {
  const [{ clientId, dpopKey }, discovery] = await Promise.all([
    ensureMcpOAuthClientCredentials(),
    discoverMcpOAuth(),
  ]);
  if (!discovery.jwks_uri) {
    throw new Error("Authorization server discovery has no jwks_uri");
  }
  const app = createApp(
    {
      clientId,
      dpopClient: await createDpopClientFromKeyPair(dpopKey),
      dpopKey,
    },
    {
      issuer: discovery.issuer,
      jwksUrl: discovery.jwks_uri,
      tokenEndpoint: discovery.token_endpoint,
    }
  );
  const { port } = config;

  serve({ fetch: app.fetch, port }, () => {
    console.error(`MCP server listening on http://localhost:${port}`);
    console.error(`  Health: http://localhost:${port}/health`);
    console.error(`  MCP:    http://localhost:${port}/mcp`);
  });
}
