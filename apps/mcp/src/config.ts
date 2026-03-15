const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return fallback;
}

export const config = {
  transport: getArg("transport", "stdio") as "stdio" | "http",
  port: Number.parseInt(getArg("port", "3200"), 10),
  zentityUrl: process.env.ZENTITY_URL ?? "http://localhost:3000",
  allowedOrigins: (
    process.env.MCP_ALLOWED_ORIGINS ?? "http://localhost:*,http://127.0.0.1:*"
  ).split(","),
};
