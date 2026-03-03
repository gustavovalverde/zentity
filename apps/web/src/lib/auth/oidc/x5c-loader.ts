import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CERT_DIR = resolve(process.cwd(), ".data", "certs");

/**
 * Loads the x5c certificate chain (leaf first, CA last) from .data/certs/.
 * Returns null if certificates haven't been generated yet.
 */
export function loadX5cChain(): string[] | null {
  const leafPath = resolve(CERT_DIR, "leaf.pem");
  const caPath = resolve(CERT_DIR, "ca.pem");

  if (!(existsSync(leafPath) && existsSync(caPath))) {
    return null;
  }

  return [readFileSync(leafPath, "utf8"), readFileSync(caPath, "utf8")];
}
