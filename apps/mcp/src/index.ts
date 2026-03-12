import { config } from "./config.js";

async function main(): Promise<void> {
  if (config.transport === "http") {
    const { startHttp } = await import("./transports/http.js");
    await startHttp();
  } else {
    const { startStdio } = await import("./transports/stdio.js");
    await startStdio();
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
