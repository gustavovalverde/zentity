"use client";

const HEX_STRING_PATTERN = /^0x[0-9a-fA-F]+$/;

export type EncryptedHandle = `0x${string}`;

export function normalizeEncryptedHandle(
  encryptedHandle: unknown
): EncryptedHandle | undefined {
  if (!encryptedHandle) {
    return;
  }

  if (typeof encryptedHandle === "string") {
    const hex = encryptedHandle.startsWith("0x")
      ? encryptedHandle
      : `0x${encryptedHandle}`;
    return HEX_STRING_PATTERN.test(hex) ? (hex as EncryptedHandle) : undefined;
  }

  if (encryptedHandle instanceof Uint8Array) {
    return `0x${Array.from(encryptedHandle)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as EncryptedHandle;
  }

  return;
}

function requireNormalizedHex(
  value: Uint8Array | string | undefined,
  label: string
): EncryptedHandle {
  const normalized = normalizeEncryptedHandle(value);
  if (!normalized) {
    throw new Error(`Encrypted output missing ${label}`);
  }
  return normalized;
}

export function buildEncryptedHandle(
  encryptedHandle: Uint8Array | string | undefined,
  fieldName: string
): EncryptedHandle {
  return requireNormalizedHex(encryptedHandle, `${fieldName} handle`);
}

export function buildInputProof(
  inputProof: Uint8Array | string | undefined
): `0x${string}` {
  return requireNormalizedHex(inputProof, "input proof");
}
