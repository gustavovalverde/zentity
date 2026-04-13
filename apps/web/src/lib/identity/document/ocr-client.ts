import "server-only";

import { env } from "@/env";
import { fetchJson } from "@/lib/http/fetch";
import {
  recordOcrDuration,
  recordOcrImageBytes,
  recordOcrPayloadBytes,
} from "@/lib/observability/metrics";
import { injectTraceHeaders, withSpan } from "@/lib/observability/telemetry";

function getInternalServiceAuthHeaders(
  requestId?: string,
  flowId?: string
): Record<string, string> {
  const token = env.INTERNAL_SERVICE_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers["X-Zentity-Internal-Token"] = token;
  }
  if (requestId) {
    headers["X-Request-Id"] = requestId;
  }
  if (flowId) {
    headers["X-Zentity-Flow-Id"] = flowId;
  }
  return headers;
}

interface OcrCommitments {
  documentHash: string;
  issuingCountryCommitment?: string;
  nameCommitment: string;
  userSalt: string;
}

interface OcrExtractedData {
  dateOfBirth?: string;
  documentNumber?: string;
  expirationDate?: string; // ISO 8601: YYYY-MM-DD
  firstName?: string;
  fullName?: string;
  gender?: string; // "M" | "F"
  lastName?: string;
  nationalityCode?: string; // ISO 3166-1 alpha-3
}

export interface OcrProcessResult {
  commitments?: OcrCommitments;
  confidence: number;
  documentOrigin?: string; // ISO 3166-1 alpha-3 country code
  documentType: string;
  extractedData?: OcrExtractedData;
  validationIssues: string[];
}

/** OCR processing timeout (40 seconds) - slightly less than client timeout. */
const OCR_TIMEOUT_MS = 40_000;
/** Upper bound for base64 image payloads sent to OCR service. */
const MAX_OCR_IMAGE_PAYLOAD_BYTES = 16_000_000;

function assertOcrImagePayloadSize(image: string): void {
  const imageBytes = Buffer.byteLength(image);
  if (imageBytes > MAX_OCR_IMAGE_PAYLOAD_BYTES) {
    throw new Error("Image payload too large for OCR processing");
  }
}

async function withOcrMetrics<T>(args: {
  operation: "process_document" | "ocr_document" | "health";
  payloadBytes?: number;
  imageBytes?: number;
  run: () => Promise<T>;
}): Promise<T> {
  const start = performance.now();
  let result: "ok" | "error" = "ok";

  if (typeof args.payloadBytes === "number") {
    recordOcrPayloadBytes(args.payloadBytes, { operation: args.operation });
  }
  if (typeof args.imageBytes === "number") {
    recordOcrImageBytes(args.imageBytes, { operation: args.operation });
  }

  try {
    return await args.run();
  } catch (error) {
    result = "error";
    throw error;
  } finally {
    recordOcrDuration(performance.now() - start, {
      operation: args.operation,
      result,
    });
  }
}

export function processDocumentOcr(args: {
  image: string;
  userSalt?: string | undefined;
  requestId?: string | undefined;
  flowId?: string | undefined;
}): Promise<OcrProcessResult> {
  try {
    assertOcrImagePayloadSize(args.image);
  } catch (err) {
    return Promise.reject(err);
  }
  const url = `${env.OCR_SERVICE_URL}/process`;
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
      withOcrMetrics({
        operation: "process_document",
        payloadBytes,
        imageBytes,
        run: () =>
          fetchJson<OcrProcessResult>(url, {
            method: "POST",
            headers: injectTraceHeaders({
              "Content-Type": "application/json",
              ...getInternalServiceAuthHeaders(args.requestId, args.flowId),
            }),
            body: payload,
            timeoutMs: OCR_TIMEOUT_MS,
          }),
      })
  );
}

export function ocrDocumentOcr(args: {
  image: string;
  requestId?: string | undefined;
  flowId?: string | undefined;
}): Promise<unknown> {
  try {
    assertOcrImagePayloadSize(args.image);
  } catch (err) {
    return Promise.reject(err);
  }
  const url = `${env.OCR_SERVICE_URL}/ocr`;
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
      withOcrMetrics({
        operation: "ocr_document",
        payloadBytes,
        imageBytes,
        run: () =>
          fetchJson<unknown>(url, {
            method: "POST",
            headers: injectTraceHeaders({
              "Content-Type": "application/json",
              ...getInternalServiceAuthHeaders(args.requestId, args.flowId),
            }),
            body: payload,
            timeoutMs: OCR_TIMEOUT_MS,
          }),
      })
  );
}

export function getOcrHealth(args?: {
  requestId?: string;
  flowId?: string;
  trace?: boolean;
}): Promise<unknown> {
  const url = `${env.OCR_SERVICE_URL}/health`;
  const run = () =>
    fetchJson<unknown>(url, {
      headers: injectTraceHeaders({
        "X-Zentity-Healthcheck": "true",
        ...getInternalServiceAuthHeaders(args?.requestId, args?.flowId),
      }),
    });
  const runWithMetrics = () =>
    withOcrMetrics({
      operation: "health",
      run,
    });

  if (args?.trace === false) {
    return runWithMetrics();
  }

  return withSpan("ocr.health", { "ocr.operation": "health" }, runWithMetrics);
}
