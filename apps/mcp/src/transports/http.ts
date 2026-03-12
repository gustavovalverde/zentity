import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "../config.js";
import { createServer } from "../server/index.js";

function getTransport(
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  sessionId: string | undefined
): WebStandardStreamableHTTPServerTransport | undefined {
  if (sessionId) {
    return transports.get(sessionId);
  }
  return undefined;
}

export function startHttp(): void {
  const app = new Hono();

  app.use(
    cors({
      origin: "*",
      allowHeaders: [
        "Content-Type",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id"],
    })
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();

  app.post("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    const existing = getTransport(transports, sessionId);

    if (existing) {
      return existing.handleRequest(c.req.raw);
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

    return transport.handleRequest(c.req.raw);
  });

  app.get("/mcp", (c) => {
    const sessionId = c.req.header("mcp-session-id");
    const transport = getTransport(transports, sessionId);
    if (!transport) {
      return c.json({ error: "No active session" }, 400);
    }
    return transport.handleRequest(c.req.raw);
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
