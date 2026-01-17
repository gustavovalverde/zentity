import "server-only";

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { logger } from "@/lib/logging/logger";

interface AssetCheck {
  id: string;
  path: string;
  minBytes: number;
}

const ASSETS: AssetCheck[] = [
  {
    id: "bb-threads",
    path: join("public", "bb", "barretenberg-threads.wasm.gz"),
    minBytes: 1024,
  },
  {
    id: "bb-single",
    path: join("public", "bb", "barretenberg.wasm.gz"),
    minBytes: 1024,
  },
  {
    id: "noir-acvm",
    path: join("public", "noir", "acvm_js_bg.wasm"),
    minBytes: 1024,
  },
  {
    id: "noir-abi",
    path: join("public", "noir", "noirc_abi_wasm_bg.wasm"),
    minBytes: 1024,
  },
];

export function checkNoirWasmAssets(): {
  ok: boolean;
  missing: string[];
  invalid: string[];
} {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const asset of ASSETS) {
    if (!existsSync(asset.path)) {
      missing.push(`${asset.id}:${asset.path}`);
      continue;
    }
    try {
      const size = statSync(asset.path).size;
      if (size < asset.minBytes) {
        invalid.push(`${asset.id}:${asset.path} (${size} bytes)`);
      }
    } catch {
      invalid.push(`${asset.id}:${asset.path} (stat failed)`);
    }
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function logNoirWasmAssetStatus(): void {
  const status = checkNoirWasmAssets();
  if (status.ok) {
    logger.info("Noir/bb.js WASM assets present");
    return;
  }

  logger.warn(
    {
      missing: status.missing,
      invalid: status.invalid,
    },
    "Noir/bb.js WASM assets missing or invalid"
  );
}
