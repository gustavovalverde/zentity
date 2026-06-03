"use client";

import type { ClearValueType, EncryptResult, Handle } from "@zama-fhe/sdk";
import type { EncryptedHandle } from "./encrypted-values";

import {
  buildEncryptedHandle,
  buildInputProof,
  normalizeEncryptedHandle,
} from "./encrypted-values";

export interface IdentityAttributesForAttestation {
  birthYearOffset: number;
  complianceLevel: number;
  countryCode: number;
  isBlacklisted: boolean;
}

export interface EncryptedIdentityAttributes {
  birthYearOffset: EncryptedHandle;
  complianceLevel: EncryptedHandle;
  countryCode: EncryptedHandle;
  inputProof: `0x${string}`;
  isBlacklisted: EncryptedHandle;
}

export interface IdentityAttributeHandles {
  birthYearOffset: EncryptedHandle;
  complianceLevel: EncryptedHandle;
  countryCode: EncryptedHandle;
  isBlacklisted: EncryptedHandle;
}

export interface DecryptedIdentityAttributes {
  birthYearOffset: number;
  complianceLevel: number;
  countryCode: number;
  isBlacklisted: boolean;
}

export function buildEncryptedIdentityAttributes(
  encryptedInput: EncryptResult
): EncryptedIdentityAttributes {
  return {
    birthYearOffset: buildEncryptedHandle(
      encryptedInput.handles[0],
      "birth-year offset"
    ),
    countryCode: buildEncryptedHandle(encryptedInput.handles[1], "country"),
    complianceLevel: buildEncryptedHandle(
      encryptedInput.handles[2],
      "compliance level"
    ),
    isBlacklisted: buildEncryptedHandle(
      encryptedInput.handles[3],
      "blacklist status"
    ),
    inputProof: buildInputProof(encryptedInput.inputProof),
  };
}

export function resolveIdentityAttributeHandles(input: {
  birthYearOffset: unknown;
  complianceLevel: unknown;
  countryCode: unknown;
  isBlacklisted: unknown;
}): IdentityAttributeHandles | null {
  const birthYearOffset = normalizeEncryptedHandle(input.birthYearOffset);
  const countryCode = normalizeEncryptedHandle(input.countryCode);
  const complianceLevel = normalizeEncryptedHandle(input.complianceLevel);
  const isBlacklisted = normalizeEncryptedHandle(input.isBlacklisted);

  if (!(birthYearOffset && countryCode && complianceLevel && isBlacklisted)) {
    return null;
  }

  return {
    birthYearOffset,
    countryCode,
    complianceLevel,
    isBlacklisted,
  };
}

export function buildIdentityAttributeDecryptHandles(input: {
  attributeHandles: IdentityAttributeHandles;
  registryAddress: `0x${string}`;
}): Array<{ contractAddress: `0x${string}`; handle: Handle }> {
  const { attributeHandles, registryAddress } = input;
  return [
    attributeHandles.birthYearOffset,
    attributeHandles.countryCode,
    attributeHandles.complianceLevel,
    attributeHandles.isBlacklisted,
  ].map((handle) => ({ handle, contractAddress: registryAddress }));
}

export function deriveDecryptedIdentityAttributes(input: {
  attributeHandles: IdentityAttributeHandles;
  clearValues: Record<Handle, ClearValueType>;
}): DecryptedIdentityAttributes {
  const { attributeHandles, clearValues } = input;
  return {
    birthYearOffset: Number(clearValues[attributeHandles.birthYearOffset] ?? 0),
    countryCode: Number(clearValues[attributeHandles.countryCode] ?? 0),
    complianceLevel: Number(clearValues[attributeHandles.complianceLevel] ?? 0),
    isBlacklisted: Boolean(
      clearValues[attributeHandles.isBlacklisted] ?? false
    ),
  };
}
