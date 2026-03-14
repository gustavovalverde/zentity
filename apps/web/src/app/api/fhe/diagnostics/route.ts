/**
 * FHEVM diagnostics endpoint (development only).
 *
 * Validates that the relayer SDK can load its WASM dependencies
 * and create an instance inside the Next.js server runtime.
 */
import "server-only";

import fs from "node:fs";
import path from "node:path";

import { env } from "@/env";

export const runtime = "nodejs";

export async function GET() {
  if (env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const cwd = process.cwd();
  const tfheWasmPath = path.join(cwd, "node_modules/node-tfhe/tfhe_bg.wasm");
  const tkmsWasmPath = path.join(cwd, "node_modules/node-tkms/kms_lib_bg.wasm");

  const chainId = 11_155_111;
  const rpcUrl = env.NEXT_PUBLIC_FHEVM_RPC_URL;

  let instanceOk = false;
  let instanceError: string | null = null;
  let publicKeyId: string | null = null;
  let tfheModuleLoaded = false;

  try {
    const [relayerSdk, tfheModuleRaw] = await Promise.all([
      import("@zama-fhe/relayer-sdk/node"),
      import("node-tfhe"),
    ]);
    const { createInstance, SepoliaConfig } = relayerSdk;
    const tfheModule = tfheModuleRaw as { __wasm?: unknown };
    tfheModuleLoaded = Boolean(tfheModule.__wasm);

    if (!rpcUrl) {
      throw new Error("FHEVM_RPC_URL is required for relayer SDK diagnostics");
    }

    const instance = await createInstance({
      ...SepoliaConfig,
      network: rpcUrl,
      chainId,
    });

    const key = instance.getPublicKey?.();
    publicKeyId = key?.publicKeyId ?? null;
    instanceOk = true;
  } catch (error) {
    instanceError =
      error instanceof Error ? error.message : JSON.stringify(error);
  }

  return Response.json({
    env: {
      NEXT_PUBLIC_FHEVM_CHAIN_ID: 11_155_111,
      NEXT_PUBLIC_FHEVM_RPC_URL: env.NEXT_PUBLIC_FHEVM_RPC_URL ?? null,
    },
    paths: {
      tfheWasmPath,
      tfheWasmExists: fs.existsSync(tfheWasmPath),
      tkmsWasmPath,
      tkmsWasmExists: fs.existsSync(tkmsWasmPath),
      cwd,
    },
    tfhe: { moduleLoaded: tfheModuleLoaded },
    instance: { ok: instanceOk, publicKeyId, error: instanceError },
  });
}
