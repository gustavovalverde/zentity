import "server-only";

import { encodeAad, WRAP_AAD_CONTEXT } from "@/lib/privacy/crypto/aad";
import { encryptAesGcm } from "@/lib/privacy/crypto/aes-gcm";
import {
  deriveKekFromOpaqueExport,
  deriveKekFromPrf,
} from "@/lib/privacy/crypto/key-derivation";
import { bytesToBase64 } from "@/lib/utils/base64";

export const OPAQUE_CREDENTIAL_ID = "opaque";

interface WrappedDekPayload {
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

function serializeWrappedDek(payload: WrappedDekPayload): string {
  return JSON.stringify(payload);
}

export async function wrapDekWithPrfServer(params: {
  secretId: string;
  credentialId: string;
  userId: string;
  dek: Uint8Array;
  prfOutput: Uint8Array;
}): Promise<string> {
  const aad = encodeAad([
    WRAP_AAD_CONTEXT,
    params.secretId,
    params.credentialId,
    params.userId,
  ]);
  const kek = await deriveKekFromPrf(params.prfOutput, params.userId);
  const wrapped = await encryptAesGcm(kek, params.dek, aad);

  const payload: WrappedDekPayload = {
    alg: "AES-GCM",
    iv: bytesToBase64(wrapped.iv),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };

  return serializeWrappedDek(payload);
}

export async function wrapDekWithOpaqueExportServer(params: {
  secretId: string;
  userId: string;
  dek: Uint8Array;
  exportKey: Uint8Array;
}): Promise<string> {
  const aad = encodeAad([
    WRAP_AAD_CONTEXT,
    params.secretId,
    OPAQUE_CREDENTIAL_ID,
    params.userId,
  ]);
  const kek = await deriveKekFromOpaqueExport(params.exportKey, params.userId);
  const wrapped = await encryptAesGcm(kek, params.dek, aad);

  const payload: WrappedDekPayload = {
    alg: "AES-GCM",
    iv: bytesToBase64(wrapped.iv),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };

  return serializeWrappedDek(payload);
}
