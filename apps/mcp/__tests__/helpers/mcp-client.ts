import {
  Client,
  type ClientCapabilities,
  InMemoryTransport,
} from "@modelcontextprotocol/client";
import {
  type AuthContext,
  setProcessAuthResolver,
} from "../../src/runtime/auth-context.js";
import { createServer } from "../../src/server.js";

const STUB_AUTH = {
  oauth: {
    accessToken: "test-token",
    accountSub: "user-123",
    clientId: "test-client",
    dpopClient: {},
    dpopKey: {},
    scopes: ["openid"],
  },
} as unknown as AuthContext;

export async function connectClient(
  options: {
    auth?: unknown;
    capabilities?: ClientCapabilities;
    clientName?: string;
  } = {}
): Promise<Client> {
  const auth = (options.auth ?? STUB_AUTH) as AuthContext;
  setProcessAuthResolver(() => Promise.resolve(auth));

  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: options.clientName ?? "test-client", version: "0.1.0" },
    options.capabilities ? { capabilities: options.capabilities } : {}
  );
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}
