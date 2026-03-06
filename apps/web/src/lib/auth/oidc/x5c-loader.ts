import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CERT_DIR = resolve(process.cwd(), ".data", "certs");

/**
 * Loads the x5c certificate chain (leaf first, CA last).
 * Tries env vars first (X5C_LEAF_PEM, X5C_CA_PEM), falls back to filesystem.
 * Returns null if certificates aren't available.
 */
export function loadX5cChain(): string[] | null {
  const leafEnv = process.env.X5C_LEAF_PEM;
  const caEnv = process.env.X5C_CA_PEM;

  if (leafEnv && caEnv) {
    return [
      Buffer.from(leafEnv, "base64").toString("utf8"),
      Buffer.from(caEnv, "base64").toString("utf8"),
    ];
  }

  const leafPath = resolve(CERT_DIR, "leaf.pem");
  const caPath = resolve(CERT_DIR, "ca.pem");

  if (!(existsSync(leafPath) && existsSync(caPath))) {
    return null;
  }

  return [readFileSync(leafPath, "utf8"), readFileSync(caPath, "utf8")];
}
