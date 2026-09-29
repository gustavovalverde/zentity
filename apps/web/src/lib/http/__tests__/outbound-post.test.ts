import type { AddressInfo } from "node:net";

import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  lookupMock.mockImplementation(actual.lookup);
  return {
    ...actual,
    default: { ...actual, lookup: lookupMock },
    lookup: lookupMock,
  };
});

const { postToPublicUrl } = await import("@/lib/http/outbound-post");

const DESTINATION_REFUSED = /private or reserved|internal host|must use HTTPS/;

interface ReceivedRequest {
  body: string;
  headers: IncomingMessage["headers"];
  method: string | undefined;
  url: string | undefined;
}

async function startServer(
  handler: Parameters<typeof createServer>[1]
): Promise<{ origin: string; server: Server }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { origin: `http://localhost:${port}`, server };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("postToPublicUrl", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    lookupMock.mockClear();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          })
      )
    );
  });

  it("posts the body to a permitted destination", async () => {
    const received: ReceivedRequest[] = [];
    const { origin, server } = await startServer(async (req, res) => {
      received.push({
        body: await readBody(req),
        headers: req.headers,
        method: req.method,
        url: req.url,
      });
      res.writeHead(202).end();
    });
    servers.push(server);

    const status = await postToPublicUrl(`${origin}/validity`, {
      body: "a.b.c",
      headers: { "Content-Type": "application/jwt" },
    });

    expect(status).toBe(202);
    expect(received).toEqual([
      expect.objectContaining({
        body: "a.b.c",
        method: "POST",
        url: "/validity",
      }),
    ]);
    expect(received[0]?.headers["content-type"]).toBe("application/jwt");
  });

  it("returns redirects without following them", async () => {
    const hits: string[] = [];
    const { origin: targetOrigin, server: target } = await startServer(
      (req, res) => {
        hits.push(req.url ?? "");
        res.writeHead(200).end();
      }
    );
    servers.push(target);
    const { origin, server } = await startServer((_req, res) => {
      res.writeHead(307, { Location: `${targetOrigin}/internal` }).end();
    });
    servers.push(server);

    const status = await postToPublicUrl(`${origin}/validity`, {
      body: "x",
      headers: {},
    });

    expect(status).toBe(307);
    expect(hits).toEqual([]);
  });

  it("does not wait for an oversized response body", async () => {
    const { origin, server } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write(Buffer.alloc(256 * 1024, 97));
    });
    servers.push(server);

    await expect(
      postToPublicUrl(`${origin}/validity`, {
        body: "x",
        headers: {},
        timeoutMs: 1000,
      })
    ).resolves.toBe(200);
  });

  it("aborts when the destination does not answer in time", async () => {
    const { origin, server } = await startServer(() => undefined);
    servers.push(server);

    await expect(
      postToPublicUrl(`${origin}/validity`, {
        body: "x",
        headers: {},
        timeoutMs: 100,
      })
    ).rejects.toThrow();
  });

  it("refuses a public hostname that resolves to loopback", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    await expect(
      postToPublicUrl("https://rp.example.com/validity", {
        body: "x",
        headers: {},
      })
    ).rejects.toThrow(DESTINATION_REFUSED);
  });

  it("refuses when any resolved address is private", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.215.14", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);

    await expect(
      postToPublicUrl("https://rp.example.com/validity", {
        body: "x",
        headers: {},
      })
    ).rejects.toThrow(DESTINATION_REFUSED);
  });

  it("refuses an IPv4-mapped IPv6 answer for cloud metadata", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "::ffff:169.254.169.254", family: 6 },
    ]);

    await expect(
      postToPublicUrl("https://rp.example.com/validity", {
        body: "x",
        headers: {},
      })
    ).rejects.toThrow(DESTINATION_REFUSED);
  });

  it("refuses URLs rejected by the syntactic check without resolving", async () => {
    await expect(
      postToPublicUrl("https://fhe.railway.internal/validity", {
        body: "x",
        headers: {},
      })
    ).rejects.toThrow(DESTINATION_REFUSED);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("refuses loopback destinations in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { origin, server } = await startServer((_req, res) => {
      res.writeHead(200).end();
    });
    servers.push(server);

    await expect(
      postToPublicUrl(`${origin}/validity`, { body: "x", headers: {} })
    ).rejects.toThrow(DESTINATION_REFUSED);
  });
});
