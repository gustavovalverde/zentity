"use client";

import type { EncryptResult } from "@zama-fhe/sdk";
import type { EncryptedHandle } from "./encrypted-values";

import { buildEncryptedHandle, buildInputProof } from "./encrypted-values";

export interface EncryptedTokenAmount {
  amount: EncryptedHandle;
  inputProof: `0x${string}`;
}

export function buildEncryptedTokenAmount(
  encryptedInput: EncryptResult
): EncryptedTokenAmount {
  return {
    amount: buildEncryptedHandle(encryptedInput.handles[0], "token amount"),
    inputProof: buildInputProof(encryptedInput.inputProof),
  };
}
