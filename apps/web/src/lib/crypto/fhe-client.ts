import "server-only";

import { fetchJson } from "@/lib/utils";
import { getFheServiceUrl } from "@/lib/utils/service-urls";

function getInternalServiceAuthHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) return {};
  return { "X-Zentity-Internal-Token": token };
}

interface FheCiphertextResult {
  ciphertext: string;
  clientKeyId: string;
}

interface FheEncryptDobResult extends FheCiphertextResult {
  dobInt: number;
}

interface FheEncryptLivenessResult extends FheCiphertextResult {
  score: number;
}

interface FheVerifyAgeResult {
  isOver18: boolean;
}

interface FheVerifyLivenessThresholdResult {
  passesThreshold: boolean;
  threshold: number;
  computationTimeMs: number;
}

export async function encryptBirthYearFhe(args: {
  birthYear: number;
  clientKeyId: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt`;
  return fetchJson<FheCiphertextResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      birthYear: args.birthYear,
      clientKeyId: args.clientKeyId,
    }),
  });
}

export async function encryptGenderFhe(args: {
  genderCode: number;
  clientKeyId: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-gender`;
  return fetchJson<FheCiphertextResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      genderCode: args.genderCode,
      clientKeyId: args.clientKeyId,
    }),
  });
}

export async function encryptDobFhe(args: {
  dob: string;
  clientKeyId: string;
}): Promise<FheEncryptDobResult> {
  const url = `${getFheServiceUrl()}/encrypt-dob`;
  return fetchJson<FheEncryptDobResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      dob: args.dob,
      clientKeyId: args.clientKeyId,
    }),
  });
}

export async function encryptLivenessScoreFhe(args: {
  score: number;
  clientKeyId: string;
}): Promise<FheEncryptLivenessResult> {
  const url = `${getFheServiceUrl()}/encrypt-liveness`;
  return fetchJson<FheEncryptLivenessResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      score: args.score,
      clientKeyId: args.clientKeyId,
    }),
  });
}

export async function verifyAgeFhe(args: {
  ciphertext: string;
  currentYear: number;
  minAge: number;
}): Promise<FheVerifyAgeResult> {
  const url = `${getFheServiceUrl()}/verify-age`;
  return fetchJson<FheVerifyAgeResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      ciphertext: args.ciphertext,
      currentYear: args.currentYear,
      minAge: args.minAge,
    }),
  });
}

export async function verifyLivenessThresholdFhe(args: {
  ciphertext: string;
  threshold: number;
  clientKeyId: string;
}): Promise<FheVerifyLivenessThresholdResult> {
  const url = `${getFheServiceUrl()}/verify-liveness-threshold`;
  return fetchJson<FheVerifyLivenessThresholdResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      ciphertext: args.ciphertext,
      threshold: args.threshold,
      clientKeyId: args.clientKeyId,
    }),
  });
}
