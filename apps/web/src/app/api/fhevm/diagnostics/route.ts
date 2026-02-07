/**
 * FHEVM diagnostics endpoint (development only).
 *
 * This helps validate that the relayer SDK can load its wasm dependencies
 * inside the Next.js server runtime and that relayer URLs are reachable.
 */
import "server-only";

import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

interface DiagnosticResult {
  ok: boolean;
  error?: string;
  stack?: string;
  relayerStatus?: number | null;
  relayerKeyUrl?: string | null;
  relayerKeyUrlStatus?: number | null;
  publicKeyId?: string | null;
}

const readEnv = (key: string) => process.env[key] || null;

const safeString = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const cwd = process.cwd();
  const tfheWasmPath = path.join(cwd, "node_modules/node-tfhe/tfhe_bg.wasm");
  const tkmsWasmPath = path.join(cwd, "node_modules/node-tkms/kms_lib_bg.wasm");

  const relayerUrl =
    process.env.FHEVM_RELAYER_URL || process.env.NEXT_PUBLIC_FHEVM_RELAYER_URL;
  const gatewayChainId = Number(
    process.env.FHEVM_GATEWAY_CHAIN_ID ||
      process.env.NEXT_PUBLIC_FHEVM_GATEWAY_CHAIN_ID ||
      ""
  );
  const aclContractAddress =
    process.env.FHEVM_ACL_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_FHEVM_ACL_CONTRACT_ADDRESS;
  const kmsContractAddress =
    process.env.FHEVM_KMS_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_FHEVM_KMS_CONTRACT_ADDRESS;
  const inputVerifierContractAddress =
    process.env.FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS;
  const verifyingContractAddressDecryption =
    process.env.FHEVM_DECRYPTION_ADDRESS ||
    process.env.NEXT_PUBLIC_FHEVM_DECRYPTION_ADDRESS;
  const verifyingContractAddressInputVerification =
    process.env.FHEVM_INPUT_VERIFICATION_ADDRESS ||
    process.env.NEXT_PUBLIC_FHEVM_INPUT_VERIFICATION_ADDRESS;
  const chainId = Number(
    process.env.FHEVM_CHAIN_ID || process.env.NEXT_PUBLIC_FHEVM_CHAIN_ID || ""
  );
  const rpcUrl =
    process.env.FHEVM_RPC_URL || process.env.NEXT_PUBLIC_FHEVM_RPC_URL;

  let relayerStatus: number | null = null;
  let relayerKeyUrlStatus: number | null = null;
  let relayerKeyUrl: string | null = null;
  let relayerKeyJsonOk: boolean | null = null;
  let relayerKeyJsonError: string | null = null;

  if (relayerUrl) {
    try {
      const resp = await fetch(relayerUrl, { method: "GET" });
      relayerStatus = resp.status;
    } catch {
      relayerStatus = null;
    }

    try {
      const keyResp = await fetch(`${relayerUrl}/v1/keyurl`, {
        method: "GET",
      });
      relayerKeyUrlStatus = keyResp.status;
      if (keyResp.ok) {
        const keyClone = keyResp.clone();
        try {
          const parsed = await keyClone.json();
          relayerKeyJsonOk = Boolean(parsed?.response);
        } catch (error) {
          relayerKeyJsonOk = false;
          relayerKeyJsonError = safeString(error);
        }
        relayerKeyUrl = await keyResp.text();
      }
    } catch {
      relayerKeyUrlStatus = null;
    }
  }

  let instanceResult: DiagnosticResult = { ok: false };
  let tfheModuleLoaded = false;
  let tfheDeserializeError: string | null = null;
  let tfheDeserializeStack: string | null = null;
  let crsDeserializeError: string | null = null;
  let crsDeserializeStack: string | null = null;
  let publicKeySize: number | null = null;
  let crsSize: number | null = null;
  interface TfheModuleShape {
    __wasm?: unknown;
    TfheCompactPublicKey?: {
      safe_deserialize?: (bytes: Uint8Array, sizeLimit: bigint) => void;
    };
    CompactPkeCrs?: {
      safe_deserialize?: (bytes: Uint8Array, sizeLimit: bigint) => void;
    };
  }
  let publicKeyUrlStatus: number | null = null;
  let publicKeyContentType: string | null = null;
  let publicKeyBytesSupported: boolean | null = null;
  let publicKeyBytesType: string | null = null;
  let publicKeyBytesDeserializeError: string | null = null;
  let crsUrlStatus: number | null = null;
  let crsContentType: string | null = null;
  let crsBytesSupported: boolean | null = null;
  let crsBytesType: string | null = null;
  let crsBytesDeserializeError: string | null = null;
  try {
    const responseCtor = globalThis.Response as
      | { prototype?: Response }
      | undefined;
    const responseProto = responseCtor?.prototype as
      | (Response & {
          bytes?: () => Promise<Uint8Array>;
          __fhevmBytesPatch?: boolean;
        })
      | undefined;
    if (
      responseProto &&
      typeof responseProto.bytes === "function" &&
      !responseProto.__fhevmBytesPatch
    ) {
      const originalBytes = responseProto.bytes;
      const patchedBytes = async function bytesPatched(
        this: Response
      ): Promise<Uint8Array> {
        const result = (await originalBytes.call(this)) as
          | Uint8Array
          | ArrayBuffer
          | ArrayBufferView;
        if (result instanceof ArrayBuffer) {
          return new Uint8Array(result);
        }
        if (ArrayBuffer.isView(result)) {
          return new Uint8Array(
            result.buffer,
            result.byteOffset,
            result.byteLength
          );
        }
        return result as Uint8Array;
      };
      responseProto.bytes = patchedBytes as typeof responseProto.bytes;
      responseProto.__fhevmBytesPatch = true;
    }

    const [relayerSdk, tfheModuleRaw] = await Promise.all([
      import("@zama-fhe/relayer-sdk/node"),
      import("node-tfhe"),
    ]);
    const { createInstance, MainnetConfig, SepoliaConfig } = relayerSdk;
    const tfheModule = tfheModuleRaw as TfheModuleShape;
    tfheModuleLoaded = Boolean(tfheModule.__wasm);

    // Select config based on chain ID (mainnet = 1, otherwise Sepolia)
    const effectiveChainId =
      Number.isFinite(chainId) && chainId > 0 ? chainId : 11_155_111;
    const baseConfig = effectiveChainId === 1 ? MainnetConfig : SepoliaConfig;

    if (!rpcUrl) {
      throw new Error("FHEVM_RPC_URL is required for relayer SDK diagnostics");
    }

    const instance = await createInstance({
      ...baseConfig,
      network: rpcUrl,
      chainId: effectiveChainId,
      ...(Number.isFinite(gatewayChainId) && gatewayChainId > 0
        ? { gatewayChainId }
        : {}),
      ...(aclContractAddress ? { aclContractAddress } : {}),
      ...(kmsContractAddress ? { kmsContractAddress } : {}),
      ...(inputVerifierContractAddress ? { inputVerifierContractAddress } : {}),
      ...(verifyingContractAddressDecryption
        ? { verifyingContractAddressDecryption }
        : {}),
      ...(verifyingContractAddressInputVerification
        ? { verifyingContractAddressInputVerification }
        : {}),
      ...(relayerUrl ? { relayerUrl } : {}),
    });

    const publicKey = instance.getPublicKey?.();
    instanceResult = {
      ok: true,
      publicKeyId: publicKey?.publicKeyId ?? null,
    };
  } catch (error) {
    instanceResult = {
      ok: false,
      error: safeString(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  if (relayerKeyUrlStatus === 200 && relayerKeyUrl) {
    try {
      const parsed = JSON.parse(relayerKeyUrl);
      const publicKeyUrl =
        parsed?.response?.fhe_key_info?.[0]?.fhe_public_key?.urls?.[0];
      const crsUrl = parsed?.response?.crs?.["2048"]?.urls?.[0];
      if (publicKeyUrl) {
        const publicKeyResp = await fetch(publicKeyUrl);
        publicKeyUrlStatus = publicKeyResp.status;
        publicKeyContentType = publicKeyResp.headers.get("content-type");
        if (publicKeyResp.ok) {
          publicKeyBytesSupported = typeof publicKeyResp.bytes === "function";
          const arrayBufferBytes = new Uint8Array(
            await publicKeyResp.clone().arrayBuffer()
          );
          publicKeySize = arrayBufferBytes.length;
          try {
            const tfheModule = (await import("node-tfhe")) as TfheModuleShape;
            const sizeLimit = BigInt(1024 * 1024 * 512);
            tfheModule.TfheCompactPublicKey?.safe_deserialize?.(
              arrayBufferBytes,
              sizeLimit
            );
          } catch (error) {
            tfheDeserializeError = safeString(error);
            tfheDeserializeStack =
              error instanceof Error ? (error.stack ?? null) : null;
          }

          if (publicKeyBytesSupported) {
            try {
              const bytes = await publicKeyResp.bytes();
              publicKeyBytesType = bytes?.constructor?.name ?? null;
              const tfheModule = (await import("node-tfhe")) as TfheModuleShape;
              const sizeLimit = BigInt(1024 * 1024 * 512);
              tfheModule.TfheCompactPublicKey?.safe_deserialize?.(
                bytes,
                sizeLimit
              );
            } catch (error) {
              publicKeyBytesDeserializeError = safeString(error);
            }
          }
        }
      }
      if (crsUrl) {
        const crsResp = await fetch(crsUrl);
        crsUrlStatus = crsResp.status;
        crsContentType = crsResp.headers.get("content-type");
        if (crsResp.ok) {
          crsBytesSupported = typeof crsResp.bytes === "function";
          const arrayBufferBytes = new Uint8Array(
            await crsResp.clone().arrayBuffer()
          );
          crsSize = arrayBufferBytes.length;
          try {
            const tfheModule = (await import("node-tfhe")) as TfheModuleShape;
            const sizeLimit = BigInt(1024 * 1024 * 512);
            tfheModule.CompactPkeCrs?.safe_deserialize?.(
              arrayBufferBytes,
              sizeLimit
            );
          } catch (error) {
            crsDeserializeError = safeString(error);
            crsDeserializeStack =
              error instanceof Error ? (error.stack ?? null) : null;
          }

          if (crsBytesSupported) {
            try {
              const bytes = await crsResp.bytes();
              crsBytesType = bytes?.constructor?.name ?? null;
              const tfheModule = (await import("node-tfhe")) as TfheModuleShape;
              const sizeLimit = BigInt(1024 * 1024 * 512);
              tfheModule.CompactPkeCrs?.safe_deserialize?.(bytes, sizeLimit);
            } catch (error) {
              crsBytesDeserializeError = safeString(error);
            }
          }
        }
      }
    } catch (error) {
      relayerKeyJsonError = safeString(error);
    }
  }

  const payload = {
    env: {
      FHEVM_RELAYER_URL: readEnv("FHEVM_RELAYER_URL"),
      NEXT_PUBLIC_FHEVM_RELAYER_URL: readEnv("NEXT_PUBLIC_FHEVM_RELAYER_URL"),
      FHEVM_GATEWAY_CHAIN_ID: readEnv("FHEVM_GATEWAY_CHAIN_ID"),
      NEXT_PUBLIC_FHEVM_GATEWAY_CHAIN_ID: readEnv(
        "NEXT_PUBLIC_FHEVM_GATEWAY_CHAIN_ID"
      ),
      FHEVM_CHAIN_ID: readEnv("FHEVM_CHAIN_ID"),
      NEXT_PUBLIC_FHEVM_CHAIN_ID: readEnv("NEXT_PUBLIC_FHEVM_CHAIN_ID"),
      FHEVM_RPC_URL: readEnv("FHEVM_RPC_URL"),
      NEXT_PUBLIC_FHEVM_RPC_URL: readEnv("NEXT_PUBLIC_FHEVM_RPC_URL"),
      FHEVM_ACL_CONTRACT_ADDRESS: readEnv("FHEVM_ACL_CONTRACT_ADDRESS"),
      FHEVM_KMS_CONTRACT_ADDRESS: readEnv("FHEVM_KMS_CONTRACT_ADDRESS"),
      FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS: readEnv(
        "FHEVM_INPUT_VERIFIER_CONTRACT_ADDRESS"
      ),
      FHEVM_DECRYPTION_ADDRESS: readEnv("FHEVM_DECRYPTION_ADDRESS"),
      FHEVM_INPUT_VERIFICATION_ADDRESS: readEnv(
        "FHEVM_INPUT_VERIFICATION_ADDRESS"
      ),
    },
    paths: {
      tfheWasmPath,
      tfheWasmExists: fs.existsSync(tfheWasmPath),
      tkmsWasmPath,
      tkmsWasmExists: fs.existsSync(tkmsWasmPath),
      cwd,
    },
    relayer: {
      relayerStatus,
      relayerKeyUrlStatus,
      relayerKeyUrl,
      relayerKeyJsonOk,
      relayerKeyJsonError,
      publicKeyUrlStatus,
      publicKeyContentType,
      publicKeyBytesSupported,
      publicKeyBytesType,
      publicKeyBytesDeserializeError,
      crsUrlStatus,
      crsContentType,
      crsBytesSupported,
      crsBytesType,
      crsBytesDeserializeError,
    },
    tfhe: {
      moduleLoaded: tfheModuleLoaded,
      publicKeySize,
      crsSize,
      deserializeError: tfheDeserializeError,
      deserializeStack: tfheDeserializeStack,
      crsDeserializeError,
      crsDeserializeStack,
    },
    instance: instanceResult,
  };

  return Response.json(payload, { status: 200 });
}
