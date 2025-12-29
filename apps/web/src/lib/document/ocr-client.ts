import "server-only";

import { fetchJson } from "@/lib/utils";
import { getOcrServiceUrl } from "@/lib/utils/service-urls";

function getInternalServiceAuthHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) return {};
  return { "X-Zentity-Internal-Token": token };
}

interface OcrCommitments {
  documentHash: string;
  nameCommitment: string;
  issuingCountryCommitment?: string;
  userSalt: string;
}

interface OcrExtractedData {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  documentNumber?: string;
  dateOfBirth?: string;
  expirationDate?: string; // ISO 8601: YYYY-MM-DD
  nationalityCode?: string; // ISO 3166-1 alpha-3
  gender?: string; // "M" | "F"
}

export interface OcrProcessResult {
  commitments?: OcrCommitments;
  documentType: string;
  documentOrigin?: string; // ISO 3166-1 alpha-3 country code
  confidence: number;
  extractedData?: OcrExtractedData;
  validationIssues: string[];
}

/** OCR processing timeout (40 seconds) - slightly less than client timeout. */
const OCR_TIMEOUT_MS = 40000;

export async function processDocumentOcr(args: {
  image: string;
  userSalt?: string;
}): Promise<OcrProcessResult> {
  const url = `${getOcrServiceUrl()}/process`;
  return fetchJson<OcrProcessResult>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      image: args.image,
      userSalt: args.userSalt,
    }),
    timeoutMs: OCR_TIMEOUT_MS,
  });
}

export async function ocrDocumentOcr(args: {
  image: string;
}): Promise<unknown> {
  const url = `${getOcrServiceUrl()}/ocr`;
  return fetchJson<unknown>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalServiceAuthHeaders(),
    },
    body: JSON.stringify({
      image: args.image,
    }),
    timeoutMs: OCR_TIMEOUT_MS,
  });
}

export async function getOcrHealth(): Promise<unknown> {
  const url = `${getOcrServiceUrl()}/health`;
  return fetchJson<unknown>(url, {
    headers: {
      ...getInternalServiceAuthHeaders(),
    },
  });
}
