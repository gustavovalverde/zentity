/**
 * Logger for Socket.io liveness handler.
 *
 * This is a standalone logger that doesn't use `server-only` since the socket
 * handler runs outside of Next.js RSC context. It uses pino directly with
 * the same configuration as the main logger.
 */

import pino from "pino";

import { env } from "@/env";

export type Logger = import("pino").Logger;

const isDev = env.NODE_ENV !== "production";
const logLevel = env.LOG_LEVEL || (isDev ? "debug" : "info");

export const socketLogger: Logger = pino({
  level: logLevel,
  base: {
    service: "zentity-web",
    component: "liveness-socket",
    env: env.NODE_ENV,
  },
});
