import { fetchJson } from "@/lib/http";
import { getZkServiceUrl } from "@/lib/service-urls";

export interface ZkAgeProofResult {
  proof: unknown;
  publicSignals: string[];
  generationTimeMs: number;
}

export interface ZkDocValidityProofResult {
  proof: unknown;
  publicSignals: string[];
  isValid: boolean;
  generationTimeMs: number;
}

export interface ZkVerifyProofResult {
  isValid: boolean;
}

export interface ZkFaceMatchProofResult {
  proof: unknown;
  publicSignals: string[];
  isMatch: boolean;
  threshold: number;
  generationTimeMs?: number;
}

export interface ZkNationalityProofResult {
  proof: unknown;
  publicSignals: string[];
  isMember: boolean;
  groupName: string;
  merkleRoot: string;
  generationTimeMs: number;
  solidityCalldata?: unknown;
}

export interface ZkVerifyNationalityProofResult {
  isValid: boolean;
  proofIsMember: boolean;
  merkleRoot: string;
  verificationTimeMs: number;
}

export async function generateAgeProofZk(args: {
  birthYear: number;
  currentYear: number;
  minAge: number;
}): Promise<ZkAgeProofResult> {
  const url = `${getZkServiceUrl()}/generate-proof`;
  return fetchJson<ZkAgeProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      birthYear: args.birthYear,
      currentYear: args.currentYear,
      minAge: args.minAge,
    }),
  });
}

export async function generateDocValidityProofZk(args: {
  expiryDate: string;
}): Promise<ZkDocValidityProofResult> {
  const url = `${getZkServiceUrl()}/docvalidity/generate`;
  return fetchJson<ZkDocValidityProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expiryDate: args.expiryDate,
    }),
  });
}

export async function generateFaceMatchProofZk(args: {
  similarityScore: number;
  threshold: number;
}): Promise<ZkFaceMatchProofResult> {
  const url = `${getZkServiceUrl()}/facematch/generate`;
  return fetchJson<ZkFaceMatchProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      similarityScore: args.similarityScore,
      threshold: args.threshold,
    }),
  });
}

export async function verifyProofZk(args: {
  proof: unknown;
  publicSignals: unknown;
}): Promise<ZkVerifyProofResult> {
  const url = `${getZkServiceUrl()}/verify-proof`;
  return fetchJson<ZkVerifyProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof: args.proof,
      publicSignals: args.publicSignals,
    }),
  });
}

export async function verifyFaceMatchProofZk(args: {
  proof: unknown;
  publicSignals: unknown;
}): Promise<ZkVerifyProofResult> {
  const url = `${getZkServiceUrl()}/facematch/verify`;
  return fetchJson<ZkVerifyProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof: args.proof,
      publicSignals: args.publicSignals,
    }),
  });
}

export async function verifyDocValidityProofZk(args: {
  proof: unknown;
  publicSignals: unknown;
}): Promise<ZkVerifyProofResult> {
  const url = `${getZkServiceUrl()}/docvalidity/verify`;
  return fetchJson<ZkVerifyProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof: args.proof,
      publicSignals: args.publicSignals,
    }),
  });
}

export async function generateNationalityProofZk(args: {
  nationalityCode: string;
  groupName: string;
}): Promise<ZkNationalityProofResult> {
  const url = `${getZkServiceUrl()}/nationality/generate`;
  return fetchJson<ZkNationalityProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nationalityCode: args.nationalityCode.toUpperCase(),
      groupName: args.groupName.toUpperCase(),
    }),
  });
}

export async function verifyNationalityProofZk(args: {
  proof: unknown;
  publicSignals: unknown[];
}): Promise<ZkVerifyNationalityProofResult> {
  const url = `${getZkServiceUrl()}/nationality/verify`;
  return fetchJson<ZkVerifyNationalityProofResult>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proof: args.proof,
      publicSignals: args.publicSignals,
    }),
  });
}

export async function listNationalityGroupsZk(): Promise<unknown> {
  const url = `${getZkServiceUrl()}/nationality/groups`;
  return fetchJson<unknown>(url);
}

export async function getNationalityGroupZk(args: {
  group: string;
}): Promise<unknown> {
  const url = `${getZkServiceUrl()}/nationality/groups/${encodeURIComponent(args.group)}`;
  return fetchJson<unknown>(url);
}

export async function checkNationalityMembershipZk(args: {
  code: string;
  group: string;
}): Promise<unknown> {
  const url = `${getZkServiceUrl()}/nationality/check?code=${encodeURIComponent(args.code)}&group=${encodeURIComponent(args.group)}`;
  return fetchJson<unknown>(url);
}
