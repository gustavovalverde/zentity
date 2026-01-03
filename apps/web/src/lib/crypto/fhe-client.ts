import "server-only";

import { gunzipSync, gzipSync } from "node:zlib";

import { decode, encode } from "@msgpack/msgpack";

import {
  recordFheDuration,
  recordFhePayloadBytes,
} from "@/lib/observability/metrics";
import {
  hashIdentifier,
  injectTraceHeaders,
  withSpan,
} from "@/lib/observability/telemetry";
import { HttpError } from "@/lib/utils/http";
import { getFheServiceUrl } from "@/lib/utils/service-urls";

function getInternalServiceAuthHeaders(
  requestId?: string,
  flowId?: string
): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
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

export type FheOperation =
  | "register_key"
  | "encrypt_batch"
  | "encrypt_birth_year_offset"
  | "encrypt_country_code"
  | "encrypt_compliance_level"
  | "encrypt_liveness"
  | "verify_age_offset"
  | "verify_liveness_threshold";

export class FheServiceError extends Error {
  readonly operation: FheOperation;
  readonly kind: "http" | "timeout" | "network" | "unknown";
  readonly status?: number;
  readonly bodyText?: string;

  constructor(args: {
    operation: FheOperation;
    message: string;
    kind: "http" | "timeout" | "network" | "unknown";
    status?: number;
    bodyText?: string;
  }) {
    super(args.message);
    this.name = "FheServiceError";
    this.operation = args.operation;
    this.kind = args.kind;
    this.status = args.status;
    this.bodyText = args.bodyText;
  }
}

async function safeReadBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

interface FetchMsgpackOptions extends RequestInit {
  timeoutMs?: number;
}

async function fetchMsgpack<T>(
  url: string,
  payload: unknown,
  init?: FetchMsgpackOptions
): Promise<T> {
  const { timeoutMs = 60_000, ...fetchInit } = init ?? {};

  const encoded = encode(payload);
  const compressed = gzipSync(encoded);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
      body: compressed,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(url, timeoutMs);
    }
    throw error;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const bodyText = await safeReadBodyText(response);
    throw new HttpError({
      message: `Request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      statusText: response.statusText,
      url,
      bodyText,
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hasGzipMagic =
    buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const decodedBytes = hasGzipMagic ? gunzipSync(buffer) : buffer;

  try {
    return decode(decodedBytes) as T;
  } catch {
    const bodyText = buffer.toString("utf8");
    throw new HttpError({
      message: "Invalid msgpack response",
      status: response.status,
      statusText: response.statusText,
      url,
      bodyText,
    });
  }
}

async function withFheError<T>(
  operation: FheOperation,
  run: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await run();
    recordFheDuration(performance.now() - start, {
      operation,
      result: "ok",
    });
    return result;
  } catch (error) {
    const durationMs = performance.now() - start;
    if (error instanceof FheServiceError) {
      recordFheDuration(durationMs, {
        operation,
        result: "error",
        error_kind: error.kind,
      });
      throw error;
    }
    if (error instanceof HttpError) {
      recordFheDuration(durationMs, {
        operation,
        result: "error",
        error_kind: "http",
      });
      throw new FheServiceError({
        operation,
        message: error.message,
        kind: "http",
        status: error.status,
        bodyText: error.bodyText,
      });
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      recordFheDuration(durationMs, {
        operation,
        result: "error",
        error_kind: "timeout",
      });
      throw new FheServiceError({
        operation,
        message: error.message,
        kind: "timeout",
      });
    }
    if (error instanceof Error) {
      recordFheDuration(durationMs, {
        operation,
        result: "error",
        error_kind: "network",
      });
      throw new FheServiceError({
        operation,
        message: error.message,
        kind: "network",
      });
    }
    recordFheDuration(durationMs, {
      operation,
      result: "error",
      error_kind: "unknown",
    });
    throw new FheServiceError({
      operation,
      message: "Unknown FHE service error",
      kind: "unknown",
    });
  }
}

interface FheCiphertextResult {
  ciphertext: string;
}

interface FheBatchEncryptResponse {
  birthYearOffsetCiphertext?: string | null;
  countryCodeCiphertext?: string | null;
  complianceLevelCiphertext?: string | null;
  livenessScoreCiphertext?: string | null;
}

interface FheEncryptLivenessResult extends FheCiphertextResult {
  score: number;
}

interface FheVerifyAgeResult {
  resultCiphertext: string;
}

interface FheVerifyLivenessThresholdResult {
  passesCiphertext: string;
  threshold: number;
}

interface FheRegisterKeyResult {
  keyId: string;
}

function buildMsgpackHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  return injectTraceHeaders({
    "Content-Type": "application/msgpack",
    "Content-Encoding": "gzip",
    Accept: "application/msgpack",
    "Accept-Encoding": "gzip",
    ...extra,
  });
}

export function encryptBatchFhe(args: {
  keyId: string;
  birthYearOffset?: number;
  countryCode?: number;
  complianceLevel?: number;
  livenessScore?: number;
  requestId?: string;
  flowId?: string;
}): Promise<FheBatchEncryptResponse> {
  const url = `${getFheServiceUrl()}/encrypt-batch`;
  const payload = {
    keyId: args.keyId,
    birthYearOffset: args.birthYearOffset,
    countryCode: args.countryCode,
    complianceLevel: args.complianceLevel,
    livenessScore: args.livenessScore,
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  recordFhePayloadBytes(payloadBytes, { operation: "encrypt_batch" });
  return withFheError("encrypt_batch", () =>
    withSpan(
      "fhe.encrypt_batch",
      {
        "fhe.operation": "encrypt_batch",
        "fhe.request_bytes": payloadBytes,
        "fhe.key_id_hash": hashIdentifier(args.keyId),
      },
      () =>
        fetchMsgpack<FheBatchEncryptResponse>(url, payload, {
          method: "POST",
          headers: buildMsgpackHeaders(
            getInternalServiceAuthHeaders(args.requestId, args.flowId)
          ),
        })
    )
  );
}

export async function encryptBirthYearOffsetFhe(args: {
  birthYearOffset: number;
  keyId: string;
  requestId?: string;
  flowId?: string;
}): Promise<FheCiphertextResult> {
  const result = await encryptBatchFhe({
    keyId: args.keyId,
    birthYearOffset: args.birthYearOffset,
    requestId: args.requestId,
    flowId: args.flowId,
  });
  const ciphertext = result.birthYearOffsetCiphertext;
  if (!ciphertext) {
    throw new FheServiceError({
      operation: "encrypt_birth_year_offset",
      message: "Missing birth year ciphertext from FHE batch response",
      kind: "unknown",
    });
  }
  return { ciphertext };
}

export async function encryptLivenessScoreFhe(args: {
  score: number;
  keyId: string;
  requestId?: string;
  flowId?: string;
}): Promise<FheEncryptLivenessResult> {
  const result = await encryptBatchFhe({
    keyId: args.keyId,
    livenessScore: args.score,
    requestId: args.requestId,
    flowId: args.flowId,
  });
  const ciphertext = result.livenessScoreCiphertext;
  if (!ciphertext) {
    throw new FheServiceError({
      operation: "encrypt_liveness",
      message: "Missing liveness ciphertext from FHE batch response",
      kind: "unknown",
    });
  }
  return { ciphertext, score: args.score };
}

export function registerFheKey(args: {
  serverKey: string;
  publicKey: string;
  requestId?: string;
  flowId?: string;
}): Promise<FheRegisterKeyResult> {
  const url = `${getFheServiceUrl()}/keys/register`;
  const payload = {
    serverKey: args.serverKey,
    publicKey: args.publicKey,
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  const serverKeyBytes = Buffer.byteLength(args.serverKey);
  const publicKeyBytes = Buffer.byteLength(args.publicKey);
  recordFhePayloadBytes(payloadBytes, { operation: "register_key" });
  return withFheError("register_key", () =>
    withSpan(
      "fhe.register_key",
      {
        "fhe.operation": "register_key",
        "fhe.request_bytes": payloadBytes,
        "fhe.server_key_bytes": serverKeyBytes,
        "fhe.public_key_bytes": publicKeyBytes,
      },
      () =>
        fetchMsgpack<FheRegisterKeyResult>(url, payload, {
          method: "POST",
          headers: buildMsgpackHeaders(
            getInternalServiceAuthHeaders(args.requestId, args.flowId)
          ),
        })
    )
  );
}

export function verifyAgeFhe(args: {
  ciphertext: string;
  currentYear: number;
  minAge: number;
  keyId: string;
  requestId?: string;
  flowId?: string;
}): Promise<FheVerifyAgeResult> {
  const url = `${getFheServiceUrl()}/verify-age-offset`;
  const payload = {
    ciphertext: args.ciphertext,
    currentYear: args.currentYear,
    minAge: args.minAge,
    keyId: args.keyId,
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  const ciphertextBytes = Buffer.byteLength(args.ciphertext);
  recordFhePayloadBytes(payloadBytes, { operation: "verify_age_offset" });
  return withFheError("verify_age_offset", () =>
    withSpan(
      "fhe.verify_age_offset",
      {
        "fhe.operation": "verify_age_offset",
        "fhe.request_bytes": payloadBytes,
        "fhe.ciphertext_bytes": ciphertextBytes,
        "fhe.key_id_hash": hashIdentifier(args.keyId),
      },
      () =>
        fetchMsgpack<FheVerifyAgeResult>(url, payload, {
          method: "POST",
          headers: buildMsgpackHeaders(
            getInternalServiceAuthHeaders(args.requestId, args.flowId)
          ),
        })
    )
  );
}

export function verifyLivenessThresholdFhe(args: {
  ciphertext: string;
  threshold: number;
  keyId: string;
  requestId?: string;
  flowId?: string;
}): Promise<FheVerifyLivenessThresholdResult> {
  const url = `${getFheServiceUrl()}/verify-liveness-threshold`;
  const payload = {
    ciphertext: args.ciphertext,
    threshold: args.threshold,
    keyId: args.keyId,
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  const ciphertextBytes = Buffer.byteLength(args.ciphertext);
  recordFhePayloadBytes(payloadBytes, {
    operation: "verify_liveness_threshold",
  });
  return withFheError("verify_liveness_threshold", () =>
    withSpan(
      "fhe.verify_liveness_threshold",
      {
        "fhe.operation": "verify_liveness_threshold",
        "fhe.request_bytes": payloadBytes,
        "fhe.ciphertext_bytes": ciphertextBytes,
        "fhe.key_id_hash": hashIdentifier(args.keyId),
      },
      () =>
        fetchMsgpack<FheVerifyLivenessThresholdResult>(url, payload, {
          method: "POST",
          headers: buildMsgpackHeaders(
            getInternalServiceAuthHeaders(args.requestId, args.flowId)
          ),
        })
    )
  );
}
