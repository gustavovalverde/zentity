const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < args.length) {
    const value = args[index + 1];
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

const port = Number.parseInt(getArg("port", "3200"), 10);

export const config = {
  transport: getArg("transport", "stdio") as "stdio" | "http",
  port,
  zentityUrl: process.env.ZENTITY_URL ?? "http://localhost:3000",
  mcpPublicUrl: process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}`,
  allowedOrigins: (
    process.env.MCP_ALLOWED_ORIGINS ?? "http://localhost:*,http://127.0.0.1:*"
  ).split(","),
};
