import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server/index.js";

export async function startStdio(): Promise<void> {
  const { server, cleanup } = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
}
