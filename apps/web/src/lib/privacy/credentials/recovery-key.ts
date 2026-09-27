/**
 * Recovery Key Credential Module
 *
 * A recovery key is 256 bits of browser-generated entropy shown to the user
 * once as 24 BIP-39 words. It never leaves the browser and is never stored:
 * only a vault-key wrapper under its HKDF-derived KEK is persisted.
 */

import {
  generateMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

import { RECOVERY_KEY_CREDENTIAL_ID } from "@/lib/privacy/secrets/catalog";

import { deriveKekFromRecoveryKey } from "./derivation";
import { unwrapDek, wrapDek } from "./wrap";

const RECOVERY_KEY_STRENGTH_BITS = 256;
const RECOVERY_KEY_WORD_COUNT = 24;
const WHITESPACE_RE = /\s+/;
const WORD_NUMBERING_RE = /^\d+[.)]?/;

interface RecoveryKey {
  key: Uint8Array;
  words: string[];
}

export function generateRecoveryKey(): RecoveryKey {
  const phrase = generateMnemonic(wordlist, RECOVERY_KEY_STRENGTH_BITS);
  return {
    key: mnemonicToEntropy(phrase, wordlist),
    words: phrase.split(" "),
  };
}

/**
 * Parse user input (any spacing or case, optional numbering) into the
 * recovery key entropy. Returns null when the words are not a valid key.
 */
export function parseRecoveryKey(input: string): Uint8Array | null {
  const words = input
    .toLowerCase()
    .split(WHITESPACE_RE)
    .map((word) => word.replace(WORD_NUMBERING_RE, ""))
    .filter(Boolean);
  if (words.length !== RECOVERY_KEY_WORD_COUNT) {
    return null;
  }
  const phrase = words.join(" ");
  if (!validateMnemonic(phrase, wordlist)) {
    return null;
  }
  return mnemonicToEntropy(phrase, wordlist);
}

export async function wrapDekWithRecoveryKey(params: {
  secretId: string;
  userId: string;
  dek: Uint8Array;
  recoveryKey: Uint8Array;
}): Promise<string> {
  const kek = await deriveKekFromRecoveryKey(params.recoveryKey, params.userId);
  return wrapDek({
    secretId: params.secretId,
    credentialId: RECOVERY_KEY_CREDENTIAL_ID,
    userId: params.userId,
    dek: params.dek,
    kek,
  });
}

export async function unwrapDekWithRecoveryKey(params: {
  secretId: string;
  userId: string;
  wrappedDek: string;
  recoveryKey: Uint8Array;
}): Promise<Uint8Array> {
  const kek = await deriveKekFromRecoveryKey(params.recoveryKey, params.userId);
  return unwrapDek({
    secretId: params.secretId,
    credentialId: RECOVERY_KEY_CREDENTIAL_ID,
    userId: params.userId,
    wrappedDek: params.wrappedDek,
    kek,
  });
}
