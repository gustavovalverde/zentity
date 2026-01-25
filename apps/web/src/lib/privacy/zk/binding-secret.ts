"use client";

import "client-only";

/**
 * Binding Secret Derivation
 *
 * Derives binding secrets for identity binding proofs across all three
 * authentication modes (passkey, OPAQUE, wallet). Each mode produces
 * different cryptographic material, but the binding commitment formula
 * is the same: Poseidon2(binding_secret || user_id_hash || document_hash)
 *
 * Privacy characteristics per mode:
 * - Passkey: Highest privacy (PRF is opaque, device-bound)
 * - OPAQUE:  Medium privacy (deterministic, password-based)
 * - Wallet:  Lower privacy (signature publicly verifiable, linkable by address)
 */

import { AuthMode } from "./proof-types";

/**
 * HKDF info strings for binding secret derivation.
 * Separate from KEK derivation to prevent cross-use attacks.
 */
const BINDING_HKDF_INFO = {
  PASSKEY: "zentity-binding-passkey-v1",
  OPAQUE: "zentity-binding-opaque-v1",
  WALLET: "zentity-binding-wallet-v1",
  WALLET_BBS: "zentity-binding-wallet-bbs-v1",
} as const;

/**
 * Parameters for deriving a binding secret from passkey PRF.
 */
interface PasskeyBindingParams {
  authMode: typeof AuthMode.PASSKEY;
  prfOutput: Uint8Array;
  userId: string;
  documentHash: string;
}

/**
 * Parameters for deriving a binding secret from OPAQUE export key.
 */
interface OpaqueBindingParams {
  authMode: typeof AuthMode.OPAQUE;
  exportKey: Uint8Array;
  userId: string;
  documentHash: string;
}

/**
 * Parameters for deriving a binding secret from wallet signature.
 */
interface WalletBindingParams {
  authMode: typeof AuthMode.WALLET;
  signatureBytes: Uint8Array;
  userId: string;
  documentHash: string;
}

/**
 * Parameters for deriving a binding secret from BBS+ credential proof.
 * This mode provides enhanced privacy by using a derived proof hash
 * instead of a direct wallet signature.
 */
interface WalletBbsBindingParams {
  authMode: typeof AuthMode.WALLET_BBS;
  /** Hash of the BBS+ presentation proof (32 bytes) */
  bbsProofHash: Uint8Array;
  userId: string;
  documentHash: string;
}

export type BindingParams =
  | PasskeyBindingParams
  | OpaqueBindingParams
  | WalletBindingParams
  | WalletBbsBindingParams;

/**
 * Result of binding secret derivation.
 */
export interface BindingSecretResult {
  bindingSecret: Uint8Array;
  userIdHash: Uint8Array;
  documentHashBytes: Uint8Array;
}

/**
 * Derive HKDF key material from input.
 *
 * @param input - Source key material (PRF output, export key, or signature)
 * @param info - Domain separation string
 * @param salt - Optional salt (userId for wallet binding)
 * @returns 32-byte derived key
 */
async function deriveHkdf(
  input: Uint8Array,
  info: string,
  salt?: string
): Promise<Uint8Array> {
  // Convert to ArrayBuffer for WebCrypto compatibility
  const inputBuffer = new Uint8Array(input).buffer;
  const masterKey = await crypto.subtle.importKey(
    "raw",
    inputBuffer,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      salt: salt ? new TextEncoder().encode(salt) : new Uint8Array(0),
      hash: "SHA-256",
      info: new TextEncoder().encode(info),
    },
    masterKey,
    256
  );

  return new Uint8Array(derivedBits);
}

/**
 * Hash a string to 32 bytes using SHA-256.
 */
async function sha256Hash(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(hashBuffer);
}

/**
 * Convert a hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Derive binding secret from passkey PRF output.
 *
 * The PRF output is already high-entropy (32 bytes from the authenticator).
 * We apply HKDF with domain separation to derive a purpose-specific secret.
 */
async function deriveFromPasskey(
  prfOutput: Uint8Array,
  userId: string,
  documentHash: string
): Promise<BindingSecretResult> {
  const bindingSecret = await deriveHkdf(prfOutput, BINDING_HKDF_INFO.PASSKEY);
  const userIdHash = await sha256Hash(userId);
  const documentHashBytes = hexToBytes(documentHash);

  return { bindingSecret, userIdHash, documentHashBytes };
}

/**
 * Derive binding secret from OPAQUE export key.
 *
 * The export key is 64 bytes of deterministic material from the OPAQUE protocol.
 * We apply HKDF with domain separation to derive a purpose-specific secret.
 */
async function deriveFromOpaque(
  exportKey: Uint8Array,
  userId: string,
  documentHash: string
): Promise<BindingSecretResult> {
  const bindingSecret = await deriveHkdf(exportKey, BINDING_HKDF_INFO.OPAQUE);
  const userIdHash = await sha256Hash(userId);
  const documentHashBytes = hexToBytes(documentHash);

  return { bindingSecret, userIdHash, documentHashBytes };
}

/**
 * Derive binding secret from wallet EIP-712 signature.
 *
 * The signature is 65 bytes from ECDSA signing. We include userId as HKDF salt
 * to ensure different users with the same wallet derive different secrets
 * (defense in depth). The EIP-712 message is deterministic (no timestamp) so
 * the same wallet+userId+chainId always produces the same signature and KEK.
 */
async function deriveFromWallet(
  signatureBytes: Uint8Array,
  userId: string,
  documentHash: string
): Promise<BindingSecretResult> {
  const bindingSecret = await deriveHkdf(
    signatureBytes,
    BINDING_HKDF_INFO.WALLET,
    userId
  );
  const userIdHash = await sha256Hash(userId);
  const documentHashBytes = hexToBytes(documentHash);

  return { bindingSecret, userIdHash, documentHashBytes };
}

/**
 * Derive binding secret from BBS+ credential proof hash.
 *
 * This provides enhanced privacy compared to direct wallet signatures:
 * - The BBS+ proof itself reveals only selected claims (selective disclosure)
 * - The proof hash is unlinkable to the original credential
 * - Different presentations produce different proof hashes
 *
 * The bbsProofHash should be SHA-256(presentation.proof.proof) computed
 * client-side before calling this function.
 */
async function deriveFromWalletBbs(
  bbsProofHash: Uint8Array,
  userId: string,
  documentHash: string
): Promise<BindingSecretResult> {
  const bindingSecret = await deriveHkdf(
    bbsProofHash,
    BINDING_HKDF_INFO.WALLET_BBS,
    userId
  );
  const userIdHash = await sha256Hash(userId);
  const documentHashBytes = hexToBytes(documentHash);

  return { bindingSecret, userIdHash, documentHashBytes };
}

/**
 * Derive binding secret for identity binding proof.
 *
 * This is the main entry point for binding secret derivation. It dispatches
 * to the appropriate derivation function based on auth mode.
 *
 * @param params - Auth-mode-specific parameters
 * @returns Binding secret and related data for proof generation
 *
 * @example
 * // Passkey binding
 * const result = await deriveBindingSecret({
 *   authMode: AuthMode.PASSKEY,
 *   prfOutput: prfBytes,
 *   userId: 'user-123',
 *   documentHash: '0x...',
 * });
 *
 * @example
 * // OPAQUE binding
 * const result = await deriveBindingSecret({
 *   authMode: AuthMode.OPAQUE,
 *   exportKey: exportKeyBytes,
 *   userId: 'user-123',
 *   documentHash: '0x...',
 * });
 *
 * @example
 * // Wallet binding
 * const result = await deriveBindingSecret({
 *   authMode: AuthMode.WALLET,
 *   signatureBytes: sigBytes,
 *   userId: 'user-123',
 *   documentHash: '0x...',
 * });
 */
export async function deriveBindingSecret(
  params: BindingParams
): Promise<BindingSecretResult> {
  switch (params.authMode) {
    case AuthMode.PASSKEY:
      return await deriveFromPasskey(
        params.prfOutput,
        params.userId,
        params.documentHash
      );

    case AuthMode.OPAQUE:
      return await deriveFromOpaque(
        params.exportKey,
        params.userId,
        params.documentHash
      );

    case AuthMode.WALLET:
      return await deriveFromWallet(
        params.signatureBytes,
        params.userId,
        params.documentHash
      );

    case AuthMode.WALLET_BBS:
      return await deriveFromWalletBbs(
        params.bbsProofHash,
        params.userId,
        params.documentHash
      );

    default: {
      const _exhaustive: never = params;
      throw new Error(`Unknown binding params: ${_exhaustive}`);
    }
  }
}

/**
 * Convert Uint8Array to Field-compatible hex string for Noir circuit.
 * Noir expects Field values as 0x-prefixed hex strings.
 */
export function bytesToFieldHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}

/**
 * Prepare binding proof inputs for the Noir circuit.
 *
 * Converts the derived secrets to the format expected by the circuit.
 */
export function prepareBindingProofInputs(result: BindingSecretResult): {
  bindingSecretField: string;
  userIdHashField: string;
  documentHashField: string;
} {
  return {
    bindingSecretField: bytesToFieldHex(result.bindingSecret),
    userIdHashField: bytesToFieldHex(result.userIdHash),
    documentHashField: bytesToFieldHex(result.documentHashBytes),
  };
}
