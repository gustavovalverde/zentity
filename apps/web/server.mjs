/**
 * Custom Next.js server with Socket.io for real-time liveness detection.
 *
 * Based on the official Socket.io + Next.js example:
 * https://socket.io/how-to/use-with-nextjs
 *
 * Usage:
 *   node --import tsx server.mjs
 *
 * The --import tsx flag enables TypeScript imports with path alias support.
 */

// Filter known deprecation warnings from dependencies (must be first)
// DEP0044: util.isArray is used by @tensorflow/tfjs-node internally
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, options) => {
  // Check if it's the tfjs-node util.isArray deprecation
  if (
    typeof options === "object" &&
    options?.code === "DEP0044" &&
    typeof warning === "string" &&
    warning.includes("util.isArray")
  ) {
    return; // Suppress this specific warning
  }
  // Also handle the case where options is the type string
  if (options === "DeprecationWarning" && warning?.includes?.("util.isArray")) {
    return;
  }
  return originalEmitWarning.call(process, warning, options);
};

import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";

import next from "next";
import { Server as SocketServer } from "socket.io";

// Shim `server-only` to be a no-op when running outside Next.js RSC context.
// This is safe because the socket handler only runs on the server.
const require = createRequire(import.meta.url);
require.cache[require.resolve("server-only")] = {
  id: require.resolve("server-only"),
  filename: require.resolve("server-only"),
  loaded: true,
  exports: {},
};

// Import liveness handler dynamically AFTER the server-only shim is installed.
// This is required because static imports are hoisted before any code runs.
const { handleLivenessConnection } = await import(
  "./src/lib/liveness/socket/handler.ts"
);

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);

// When using middleware, hostname and port must be provided
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

// Clean up stale lock file from previous dev server sessions
// This prevents "port already in use" style issues when the server was killed abruptly
if (dev) {
  const lockFile = join(process.cwd(), ".next", "dev", "lock");
  if (existsSync(lockFile)) {
    try {
      unlinkSync(lockFile);
      console.log("> Removed stale .next/dev/lock");
    } catch {
      // Ignore if removal fails (e.g., permissions, file already deleted)
    }
  }
}

app.prepare().then(() => {
  // Pass handler directly to createServer (official pattern)
  const httpServer = createServer(handler);

  // Attach Socket.io for liveness detection
  const io = new SocketServer(httpServer, {
    path: "/api/liveness/socket",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "*",
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 1e6, // 1MB max frame size
  });

  io.on("connection", (socket) => {
    handleLivenessConnection(socket);
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log("> Socket.io liveness endpoint: /api/liveness/socket");
      console.log("> Environment:", dev ? "development" : "production");
    });

  // Graceful shutdown with timeout and proper Next.js cleanup
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    console.log("\n> Shutting down...");

    // Force exit if shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      console.error("> Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimeout.unref();

    try {
      // 1. Stop accepting new Socket.IO connections and close existing ones
      io.close();

      // 2. Stop accepting new HTTP connections
      httpServer.close();

      // 3. Force close all HTTP connections (browsers keep keep-alive open)
      // closeAllConnections() added in Node.js 18.2.0
      httpServer.closeAllConnections();

      // 4. Close Next.js app (flushes TurboPack cache, closes watchers)
      await app.close();

      clearTimeout(forceExitTimeout);
      console.log("> Server closed");
      process.exit(0);
    } catch (err) {
      console.error("> Shutdown error:", err);
      clearTimeout(forceExitTimeout);
      process.exit(1);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
});
