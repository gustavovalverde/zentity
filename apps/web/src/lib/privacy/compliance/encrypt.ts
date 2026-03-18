import {
  COMPLIANCE_AAD_CONTEXT,
  encodeAad,
} from "@/lib/privacy/primitives/aad";
import { mlKemEncapsulate } from "@/lib/privacy/primitives/ml-kem";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

export interface ComplianceCipherBundle {
  alg: "ML-KEM-768";
  ciphertext: string;
  clientId: string;
  iv: string;
  kemCipherText: string;
  userId: string;
}

/**
 * Encrypt data for an RP using their ML-KEM-768 public key.
 *
 * Flow: ML-KEM encapsulate → AES-256-GCM encrypt with shared secret.
 * AAD binds the ciphertext to (clientId, userId), preventing cross-RP/cross-user substitution.
 */
export async function encryptForRp(
  data: Uint8Array,
  rpPublicKeyBase64: string,
  context: { clientId: string; userId: string }
): Promise<ComplianceCipherBundle> {
  const rpPublicKey = base64ToBytes(rpPublicKeyBase64);
  const { cipherText, sharedSecret } = mlKemEncapsulate(rpPublicKey);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(sharedSecret).buffer,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const aad = encodeAad([
    COMPLIANCE_AAD_CONTEXT,
    context.clientId,
    context.userId,
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: Uint8Array.from(aad).buffer },
    aesKey,
    Uint8Array.from(data).buffer
  );

  return {
    alg: "ML-KEM-768",
    kemCipherText: bytesToBase64(cipherText),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    clientId: context.clientId,
    userId: context.userId,
  };
}
