"use client";

import type { ProfileSecretPayload } from "./profile-secret";

import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";
import { buildDisplayName } from "@/lib/utils/name-utils";

export type DisclosureField =
  | "fullName"
  | "dateOfBirth"
  | "residentialAddress"
  | "addressCountryCode"
  | "nationality"
  | "documentNumber"
  | "documentType";

export interface DisclosurePayloadOptions {
  profile: ProfileSecretPayload | null;
  scope: DisclosureField[];
  rpId: string;
  packageId: string;
  createdAt: string;
  expiresAt: string;
}

export function buildDisclosurePayload(options: DisclosurePayloadOptions): {
  payload: Record<string, string>;
  encryptedFields: DisclosureField[];
} {
  if (!options.profile) {
    throw new Error("Missing profile data for disclosure.");
  }

  const profile = options.profile;
  const encryptedFields: DisclosureField[] = [];
  const payload: Record<string, string> = {
    rpId: options.rpId,
    packageId: options.packageId,
    createdAt: options.createdAt,
    expiresAt: options.expiresAt,
  };

  const fullName =
    profile.fullName ||
    buildDisplayName(profile.firstName ?? null, profile.lastName ?? null) ||
    null;

  const fieldMap: Record<DisclosureField, string | null> = {
    fullName,
    dateOfBirth: profile.dateOfBirth ?? null,
    residentialAddress: profile.residentialAddress ?? null,
    addressCountryCode: profile.addressCountryCode ?? null,
    nationality: profile.nationality ?? profile.nationalityCode ?? null,
    documentNumber: profile.documentNumber ?? null,
    documentType: profile.documentType ?? null,
  };

  const missing: DisclosureField[] = [];

  for (const field of options.scope) {
    const value = fieldMap[field];
    if (!value) {
      missing.push(field);
      continue;
    }
    payload[field] = value;
    encryptedFields.push(field);
  }

  if (missing.length > 0) {
    throw new Error(`Missing required profile fields: ${missing.join(", ")}.`);
  }

  return { payload, encryptedFields };
}

/**
 * Encrypt disclosure payload to RP's RSA public key using hybrid RSA-OAEP + AES-GCM.
 * Returns base64 of: encryptedAesKey || iv || ciphertext
 */
export async function encryptDisclosurePayload(
  payload: string,
  rpPublicKeyBase64: string
): Promise<string> {
  const publicKeyBytes = base64ToBytes(rpPublicKeyBase64);
  const publicKeyBuffer = publicKeyBytes.slice().buffer;
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );

  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payloadBytes = new TextEncoder().encode(payload);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    payloadBytes
  );

  const aesKeyRaw = await crypto.subtle.exportKey("raw", aesKey);
  const encryptedAesKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    aesKeyRaw
  );

  const result = new Uint8Array(
    encryptedAesKey.byteLength + iv.byteLength + ciphertext.byteLength
  );
  result.set(new Uint8Array(encryptedAesKey), 0);
  result.set(iv, encryptedAesKey.byteLength);
  result.set(
    new Uint8Array(ciphertext),
    encryptedAesKey.byteLength + iv.byteLength
  );

  return bytesToBase64(result);
}
