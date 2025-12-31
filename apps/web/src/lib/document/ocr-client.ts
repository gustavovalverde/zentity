import "server-only";

import { injectTraceHeaders, withSpan } from "@/lib/observability";
import { fetchJson } from "@/lib/utils";
import { getOcrServiceUrl } from "@/lib/utils/service-urls";

function getInternalServiceAuthHeaders(
  requestId?: string,
): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers["X-Zentity-Internal-Token"] = token;
  if (requestId) headers["X-Request-Id"] = requestId;
  return headers;
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
  requestId?: string;
}): Promise<OcrProcessResult> {
  const url = `${getOcrServiceUrl()}/process`;
  const payload = JSON.stringify({
    image: args.image,
    userSalt: args.userSalt,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const imageBytes = Buffer.byteLength(args.image);
  return withSpan(
    "ocr.process_document",
    {
      "ocr.operation": "process_document",
      "ocr.request_bytes": payloadBytes,
      "ocr.image_bytes": imageBytes,
    },
    () =>
      fetchJson<OcrProcessResult>(url, {
        method: "POST",
        headers: injectTraceHeaders({
          "Content-Type": "application/json",
          ...getInternalServiceAuthHeaders(args.requestId),
        }),
        body: payload,
        timeoutMs: OCR_TIMEOUT_MS,
      }),
  );
}

export async function ocrDocumentOcr(args: {
  image: string;
  requestId?: string;
}): Promise<unknown> {
  const url = `${getOcrServiceUrl()}/ocr`;
  const payload = JSON.stringify({ image: args.image });
  const payloadBytes = Buffer.byteLength(payload);
  const imageBytes = Buffer.byteLength(args.image);
  return withSpan(
    "ocr.ocr_document",
    {
      "ocr.operation": "ocr_document",
      "ocr.request_bytes": payloadBytes,
      "ocr.image_bytes": imageBytes,
    },
    () =>
      fetchJson<unknown>(url, {
        method: "POST",
        headers: injectTraceHeaders({
          "Content-Type": "application/json",
          ...getInternalServiceAuthHeaders(args.requestId),
        }),
        body: payload,
        timeoutMs: OCR_TIMEOUT_MS,
      }),
  );
}

export async function getOcrHealth(args?: {
  requestId?: string;
}): Promise<unknown> {
  const url = `${getOcrServiceUrl()}/health`;
  return withSpan("ocr.health", { "ocr.operation": "health" }, () =>
    fetchJson<unknown>(url, {
      headers: injectTraceHeaders({
        ...getInternalServiceAuthHeaders(args?.requestId),
      }),
    }),
  );
}
