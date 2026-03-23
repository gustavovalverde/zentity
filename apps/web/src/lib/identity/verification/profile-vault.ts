"use client";

import type { CachedBindingMaterial } from "@/lib/privacy/credentials/cache";

import { buildEnrollmentCredential } from "@/lib/privacy/credentials/build-enrollment-credential";

interface VerificationWalletContext {
  address: string;
  chainId: number;
}

interface VerificationProfileSecretData {
  documentHash?: string | null;
  extractedDOB?: string | null;
  extractedDocumentNumber?: string | null;
  extractedDocumentOrigin?: string | null;
  extractedDocumentType?: string | null;
  extractedExpirationDate?: number | null;
  extractedFirstName?: string | null;
  extractedFullName?: string | null;
  extractedLastName?: string | null;
  extractedNationality?: string | null;
  extractedNationalityCode?: string | null;
  userSalt?: string | null;
}

interface OcrVerificationProfileSnapshot {
  extractedDOB: string | null;
  extractedDocNumber: string | null;
  extractedExpirationDate: string | null;
  extractedFirstName: string | null;
  extractedLastName: string | null;
  extractedName: string | null;
  extractedNationality: string | null;
  extractedNationalityCode: string | null;
  userSalt: string | null;
}

interface PassportChipDisclosedData {
  dateOfBirth: string | null;
  documentType: string | null;
  fullName: string | null;
  issuingCountry: string | null;
  nationality: string | null;
  nationalityCode: string | null;
}

export function buildProfileSecretDataFromOcrSnapshot(
  snapshot: OcrVerificationProfileSnapshot
): VerificationProfileSecretData {
  return {
    extractedFullName: snapshot.extractedName,
    extractedFirstName: snapshot.extractedFirstName,
    extractedLastName: snapshot.extractedLastName,
    extractedDOB: snapshot.extractedDOB,
    extractedDocumentNumber: snapshot.extractedDocNumber,
    extractedNationality: snapshot.extractedNationality,
    extractedNationalityCode: snapshot.extractedNationalityCode,
    extractedExpirationDate: snapshot.extractedExpirationDate
      ? Number.parseInt(snapshot.extractedExpirationDate, 10) || null
      : null,
    userSalt: snapshot.userSalt,
  };
}

export function buildProfileSecretDataFromPassportDisclosure(
  disclosed: PassportChipDisclosedData
): VerificationProfileSecretData {
  return {
    extractedFullName: disclosed.fullName,
    extractedDOB: disclosed.dateOfBirth,
    extractedNationality: disclosed.nationality,
    extractedNationalityCode: disclosed.nationalityCode,
    extractedDocumentType: disclosed.documentType,
    extractedDocumentOrigin: disclosed.issuingCountry,
  };
}

export async function storeProfileSecretWithMaterial(params: {
  cachedBindingMaterial: CachedBindingMaterial;
  profileData: VerificationProfileSecretData;
  userId: string;
  wallet: VerificationWalletContext | null;
}): Promise<"stored" | "credential_unavailable"> {
  const credential = buildEnrollmentCredential(
    params.cachedBindingMaterial,
    params.userId,
    params.wallet
  );

  if (!credential) {
    return "credential_unavailable";
  }

  const { storeProfileSecret } = await import("@/lib/privacy/secrets/profile");
  await storeProfileSecret({
    extractedData: params.profileData,
    credential,
  });
  return "stored";
}
