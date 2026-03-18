import type { ComplianceCipherBundle } from "./encrypt";

import {
  COMPLIANCE_AAD_CONTEXT,
  encodeAad,
} from "@/lib/privacy/primitives/aad";
import { mlKemDecapsulate } from "@/lib/privacy/primitives/ml-kem";
import { base64ToBytes } from "@/lib/utils/base64";

/**
 * Decrypt a compliance cipher bundle using the RP's ML-KEM-768 secret key.
 *
 * AAD is reconstructed from bundle fields — the bundle is self-contained.
 * Reference utility — RPs use this to decrypt data received from Zentity.
 */
export async function decryptFromZentity(
  bundle: ComplianceCipherBundle,
  rpSecretKey: Uint8Array
): Promise<Uint8Array> {
  const kemCipherText = base64ToBytes(bundle.kemCipherText);
  const sharedSecret = mlKemDecapsulate(kemCipherText, rpSecretKey);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(sharedSecret).buffer,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  const aad = encodeAad([
    COMPLIANCE_AAD_CONTEXT,
    bundle.clientId,
    bundle.userId,
  ]);
  const iv = base64ToBytes(bundle.iv);
  const ciphertext = base64ToBytes(bundle.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(iv).buffer,
      additionalData: Uint8Array.from(aad).buffer,
    },
    aesKey,
    Uint8Array.from(ciphertext).buffer
  );

  return new Uint8Array(decrypted);
}
