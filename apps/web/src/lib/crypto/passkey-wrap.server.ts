import "server-only";

import { deriveKekFromPrf } from "@/lib/crypto/key-derivation";
import { encryptAesGcm } from "@/lib/crypto/symmetric-crypto";
import { bytesToBase64 } from "@/lib/utils/base64";

const WRAP_VERSION = "v1";
const WRAP_AAD_VERSION = "zentity-wrap-aad-v1";

interface WrappedDekPayload {
  version: typeof WRAP_VERSION;
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

const textEncoder = new TextEncoder();

function encodeAad(parts: string[]): Uint8Array {
  return textEncoder.encode(parts.join("|"));
}

function serializeWrappedDek(payload: WrappedDekPayload): string {
  return JSON.stringify(payload);
}

export async function wrapDekWithPrfServer(params: {
  secretId: string;
  credentialId: string;
  dek: Uint8Array;
  prfOutput: Uint8Array;
}): Promise<string> {
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    params.credentialId,
  ]);
  const kek = await deriveKekFromPrf(params.prfOutput);
  const wrapped = await encryptAesGcm(kek, params.dek, aad);

  const payload: WrappedDekPayload = {
    version: WRAP_VERSION,
    alg: "AES-GCM",
    iv: bytesToBase64(wrapped.iv),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };

  return serializeWrappedDek(payload);
}

export const RECOVERY_WRAP_VERSION = WRAP_VERSION;
